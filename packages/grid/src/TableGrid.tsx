'use client'
// TableGrid — the Glide DataEditor host. Wires the token→canvas theme, the 11
// typed custom cell renderers + StatusCell, the windowed data provider, frozen
// columns, row markers, a persistent add-row, and optimistic inline editing
// (with last-write-wins conflict surfacing).
//
// The interaction layer (FSD US-1.9/1.10) lives here too:
//  • Undo/redo — every grid-originated mutation (cell edit, paste, row add, row
//    delete) is recorded as a command with its inverse; Cmd/Ctrl+Z /
//    Shift+Cmd/Ctrl+Z replay it, a visible control strip mirrors the state, and
//    an imperative handle + onHistoryChange expose it to a parent.
//  • Copy — a multi-cell range serialises through the windowed cache
//    (getCellsForSelection) to TSV via core `toClipboard`.
//  • Paste — clipboard TSV/CSV (core `parseClipboard`, incl. quoted multi-line)
//    is coerced/validated against each target column type, mapped into the
//    range, persisted, and blocked for viewers.
// Glide's own clipboard keybindings are disabled so these paths own the flow;
// native keyboard nav (arrows/Enter/Tab/Escape) is untouched.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CompactSelection, DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import type {
  CellArray,
  CellClickedEventArgs,
  DataEditorRef,
  EditListItem,
  GetCellsThunk,
  GridCell,
  GridColumn,
  GridSelection,
  Item,
  Rectangle,
} from '@glideapps/glide-data-grid'
import { ConflictError, getApi, isApiError } from '@cascade/data'
import type { CascadeApi, CellEdit } from '@cascade/data'
import type { AgentCellMeta, AiCellMeta, CellValue, Column, EnrichmentCellMeta, HttpCellMeta } from '@cascade/core'
import { readAgent, readAi, readEnrichment, readHttp, toClipboard, validateValue } from '@cascade/core'
import { useGlideTheme } from './useGlideTheme'
import { useTableData } from './dataProvider'
import { cascadeCellRenderers, makeCell, makeAgentCell, makeAiCell, makeEnrichCell, makeFormulaCell, makeHttpCell, makeStatusCell, rawFromCell } from './cells'
import type { CascadeCell } from './cells'
import { useUndoRedo } from './history'
import type { HistoryState } from './history'
import { HistoryControls } from './HistoryControls'
import { cellsToStringGrid, planPaste } from './gridClipboard'
import './glideStyles'
import styles from './TableGrid.module.css'

const ROW_HEIGHT = 38
const HEADER_HEIGHT = 38

const EMPTY_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
}

// Glide's native copy/paste/cut are disabled; the interaction layer owns them so
// paste can run through core parseClipboard and every op stays undoable.
const KEYBINDINGS = { copy: false, paste: false, cut: false } as const

/** Where an enrichment cell was clicked (grid-container coords) for the popover. */
export interface CellRect {
  x: number
  y: number
  width: number
  height: number
}

/** Imperative handle so a parent can drive/relocate the undo-redo controls. */
export interface TableGridHandle {
  undo: () => void
  redo: () => void
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Patch a cell's live enrichment status/value without a full reload. */
  applyEnrichment: (recordId: string, columnId: string, meta: EnrichmentCellMeta, value?: CellValue) => void
  /** Patch a cell's live AI status/value without a full reload (Phase 3). */
  applyAi: (recordId: string, columnId: string, meta: AiCellMeta, value?: CellValue) => void
  /** Patch a cell's live agent status/value without a full reload (Phase 3 rest). */
  applyAgent: (recordId: string, columnId: string, meta: AgentCellMeta, value?: CellValue) => void
  /** Patch a cell's live HTTP status/value without a full reload (Phase 3 rest). */
  applyHttp: (recordId: string, columnId: string, meta: HttpCellMeta, value?: CellValue) => void
}

export interface TableGridProps {
  tableId: string
  /** Active view — drives filter/sort (and, later, column visibility). */
  viewId?: string
  /** API to read/write through. Defaults to the app-wide singleton. */
  api?: CascadeApi
  /** UI-level read-only gate (Viewer role). Server-side enforcement is separate. */
  readOnly?: boolean
  /** Columns that carry an enrichment waterfall — rendered from `cell.meta`. */
  enrichmentColumnIds?: string[]
  /** Columns that carry an AI config — rendered from `cell.meta.ai` (Phase 3). */
  aiColumnIds?: string[]
  /** Columns that carry an agent config — rendered from `cell.meta.agent` (Phase 3 rest). */
  agentColumnIds?: string[]
  /** Columns that carry an HTTP config — rendered from `cell.meta.http` (Phase 3 rest). */
  httpColumnIds?: string[]
  /** Columns that carry a formula — rendered from `cell.meta.formula` (Phase 3 rest). */
  formulaColumnIds?: string[]
  /** Notified when the row/range selection changes (drives "run selected rows"). */
  onSelectionChange?: (info: { recordIds: string[]; rowCount: number; hasRange: boolean }) => void
  /** Clicking a resolved enrichment cell opens the provenance popover. */
  onEnrichmentCellClick?: (ref: { recordId: string; columnId: string }, bounds: CellRect) => void
  /** Clicking a resolved AI cell opens the AI provenance popover (Phase 3). */
  onAiCellClick?: (ref: { recordId: string; columnId: string }, bounds: CellRect) => void
  /** Clicking a resolved agent cell opens the agent provenance popover (Phase 3 rest). */
  onAgentCellClick?: (ref: { recordId: string; columnId: string }, bounds: CellRect) => void
  /** Clicking a resolved HTTP cell opens the HTTP provenance popover (Phase 3 rest). */
  onHttpCellClick?: (ref: { recordId: string; columnId: string }, bounds: CellRect) => void
  /** Bump to drop the cache and re-read (after a run terminal, config change). */
  refreshToken?: number
  /**
   * Surfaces the imperative handle to the parent. `next/dynamic` (TableGridDynamic)
   * cannot forward refs, so consumers that need `applyEnrichment` for live per-cell
   * updates capture the handle here instead of via a ref.
   */
  onReady?: (handle: TableGridHandle | null) => void
  /** Notified whenever the undo/redo availability (or top-of-stack label) changes. */
  onHistoryChange?: (state: HistoryState) => void
  className?: string
}

const emptyValueFor = (column: Column): CellValue => (column.type === 'multiSelect' ? [] : null)

function isEditingText(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

export const TableGrid = forwardRef<TableGridHandle, TableGridProps>(function TableGrid(
  { tableId, viewId, api: apiProp, readOnly = false, enrichmentColumnIds, aiColumnIds, agentColumnIds, httpColumnIds, formulaColumnIds, onSelectionChange, onEnrichmentCellClick, onAiCellClick, onAgentCellClick, onHttpCellClick, refreshToken, onReady, onHistoryChange, className },
  ref,
) {
  const api = useMemo(() => apiProp ?? getApi(), [apiProp])
  const enrichCols = useMemo(() => new Set(enrichmentColumnIds ?? []), [enrichmentColumnIds])
  const aiCols = useMemo(() => new Set(aiColumnIds ?? []), [aiColumnIds])
  const agentCols = useMemo(() => new Set(agentColumnIds ?? []), [agentColumnIds])
  const httpCols = useMemo(() => new Set(httpColumnIds ?? []), [httpColumnIds])
  const formulaCols = useMemo(() => new Set(formulaColumnIds ?? []), [formulaColumnIds])
  const theme = useGlideTheme()
  const editorRef = useRef<DataEditorRef>(null)
  const [warning, setWarning] = useState<string | null>(null)
  // Conflicts are assertive (role="alert"); plain validation/info is polite
  // (role="status"). `notify` sets both the message and its severity together.
  const [warningAlert, setWarningAlert] = useState(false)
  const notify = useCallback((text: string | null, alert = false) => {
    setWarning(text)
    setWarningAlert(alert)
  }, [])

  const [columns, setColumns] = useState<Column[]>([])
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION)

  const history = useUndoRedo(onHistoryChange)

  useEffect(() => {
    let cancelled = false
    api.columns.list(tableId).then(
      (cols) => {
        if (!cancelled) setColumns(cols.slice().sort((a, b) => a.position - b.position))
      },
      () => {
        if (!cancelled) notify('Could not load columns.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, tableId])

  const data = useTableData(api, tableId, viewId)

  // Record ids are table/view-scoped, so a stale command must never replay onto
  // a different dataset. Drop history + selection whenever either changes.
  useEffect(() => {
    history.clear()
    setSelection(EMPTY_SELECTION)
  }, [tableId, viewId, history.clear])

  // --- Glide column descriptors -----------------------------------------

  const gridColumns = useMemo<GridColumn[]>(
    // Operation columns carry a type marker in the header so the output reads as
    // machine-generated (the cell body reuses the shared status system unchanged):
    // ✦ AI · ◆ agent · ⇄ HTTP · ƒ formula.
    () =>
      columns.map((c) => {
        const badge = aiCols.has(c.id) ? '✦ ' : agentCols.has(c.id) ? '◆ ' : httpCols.has(c.id) ? '⇄ ' : formulaCols.has(c.id) ? 'ƒ ' : ''
        return { id: c.id, title: `${badge}${c.name}`, width: widths[c.id] ?? c.width }
      }),
    [columns, widths, aiCols, agentCols, httpCols, formulaCols],
  )

  // Leading contiguous frozen columns pin to the left.
  const freezeColumns = useMemo(() => {
    let n = 0
    for (const c of columns) {
      if (c.isFrozen) n += 1
      else break
    }
    return n
  }, [columns])

  // --- data → cells ------------------------------------------------------

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const column = columns[col]
      if (!column) return makeStatusCell('', 'loading')
      const rowData = data.getRow(row)
      if (!rowData) return makeStatusCell(column.id, 'loading')
      const stored = rowData.cells[column.id]
      if (enrichCols.has(column.id)) return makeEnrichCell(column, stored)
      if (aiCols.has(column.id)) return makeAiCell(column, stored)
      if (agentCols.has(column.id)) return makeAgentCell(column, stored)
      if (httpCols.has(column.id)) return makeHttpCell(column, stored)
      if (formulaCols.has(column.id)) return makeFormulaCell(column, stored)
      const value: CellValue = stored ? stored.value : column.type === 'multiSelect' ? [] : null
      return makeCell(column, value)
    },
    [columns, data, enrichCols, aiCols, agentCols, httpCols, formulaCols],
  )

  // Cells for a selection rectangle (copy + fill). Served from the windowed
  // cache when present; a miss returns an async thunk that fetches the exact
  // range so off-screen copies are complete (capped so a pathological
  // whole-column selection can't request the entire table in one round-trip).
  const getCellsForSelection = useCallback(
    (rect: Rectangle): CellArray | GetCellsThunk => {
      const FETCH_CAP = 2000
      let anyMissing = false
      if (rect.height <= FETCH_CAP) {
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          if (!data.getRow(y)) {
            anyMissing = true
            break
          }
        }
      }

      const cellAt = (rowData: ReturnType<typeof data.getRow>, x: number): GridCell => {
        const column = columns[x]
        if (!column) return makeStatusCell('', 'loading')
        if (!rowData) return makeStatusCell(column.id, 'loading')
        const stored = rowData.cells[column.id]
        if (enrichCols.has(column.id)) return makeEnrichCell(column, stored)
        if (aiCols.has(column.id)) return makeAiCell(column, stored)
        if (agentCols.has(column.id)) return makeAgentCell(column, stored)
        if (httpCols.has(column.id)) return makeHttpCell(column, stored)
        if (formulaCols.has(column.id)) return makeFormulaCell(column, stored)
        const value: CellValue = stored ? stored.value : column.type === 'multiSelect' ? [] : null
        return makeCell(column, value)
      }

      if (!anyMissing) {
        const out: GridCell[][] = []
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          const rowData = data.getRow(y)
          const line: GridCell[] = []
          for (let x = rect.x; x < rect.x + rect.width; x += 1) line.push(cellAt(rowData, x))
          out.push(line)
        }
        return out
      }

      return async (): Promise<CellArray> => {
        const res = await api.records.list(tableId, { viewId, offset: rect.y, limit: rect.height })
        const out: GridCell[][] = []
        for (let i = 0; i < rect.height; i += 1) {
          const rowData = res.rows[i]
          const line: GridCell[] = []
          for (let x = rect.x; x < rect.x + rect.width; x += 1) line.push(cellAt(rowData, x))
          out.push(line)
        }
        return out
      }
    },
    [api, columns, data, tableId, viewId, enrichCols, aiCols, agentCols, httpCols, formulaCols],
  )

  // --- persistence -------------------------------------------------------

  // Apply a set of patches optimistically, then reconcile with the server
  // (updated timestamps + last-write-wins conflicts). Returns a promise so undo
  // commands can await it.
  const persistPatches = useCallback(
    (patches: CellEdit[]): Promise<void> => {
      if (patches.length === 0) return Promise.resolve()
      const now = new Date().toISOString()
      for (const p of patches) data.applyEdit(p.recordId, p.columnId, p.value, p.expectedUpdatedAt ?? now)
      return api.cells
        .patch(patches)
        .then((result) => {
          for (const u of result.updated) data.applyEdit(u.recordId, u.columnId, u.value, u.updatedAt)
          if (result.conflicts.length > 0) {
            for (const c of result.conflicts) {
              data.applyEdit(c.recordId, c.columnId, c.currentValue as CellValue, c.currentUpdatedAt)
            }
            notify('Some cells changed since you loaded them and were not overwritten.', true)
          } else {
            notify(null)
          }
        })
        .catch((err: unknown) => {
          if (err instanceof ConflictError) notify('That value changed since you loaded it.', true)
          else if (isApiError(err)) notify(err.message)
          else notify('Could not save your edit.')
          data.reload()
        })
    },
    [api, data, notify],
  )

  // Persist `forward` now and record an undoable command. Undo/redo force the
  // write (no conflict guard) so an explicit revert always lands.
  const commitCellChange = useCallback(
    (forward: CellEdit[], inverse: CellEdit[], label: string) => {
      if (forward.length === 0) return
      void persistPatches(forward)
      const force = (patches: CellEdit[]): CellEdit[] => patches.map((p) => ({ ...p, expectedUpdatedAt: undefined }))
      history.push({
        label,
        undo: () => persistPatches(force(inverse)),
        redo: () => persistPatches(force(forward)),
      })
    },
    [persistPatches, history],
  )

  const surface = useCallback((err: unknown, fallback: string) => {
    notify(isApiError(err) ? err.message : fallback)
  }, [notify])

  // --- editing -----------------------------------------------------------

  const onCellsEdited = useCallback(
    (edits: readonly EditListItem[]): boolean => {
      if (readOnly) {
        notify('Viewers have read-only access.')
        return true
      }
      const forward: CellEdit[] = []
      const inverse: CellEdit[] = []
      for (const e of edits) {
        const [col, row] = e.location
        const column = columns[col]
        if (!column) continue
        const rowData = data.getRow(row)
        if (!rowData) continue
        if (e.value.kind !== GridCellKind.Custom) continue
        const cdata = (e.value as CascadeCell).data
        if (cdata.draft === undefined) continue // opened but not changed
        const res = validateValue(column.type, rawFromCell(cdata), column.config)
        if (!res.ok) {
          notify(res.error)
          continue
        }
        const prev = rowData.cells[column.id]?.value ?? emptyValueFor(column)
        forward.push({
          recordId: rowData.row.id,
          columnId: column.id,
          value: res.value,
          expectedUpdatedAt: rowData.row.updatedAt,
        })
        inverse.push({ recordId: rowData.row.id, columnId: column.id, value: prev })
      }
      if (forward.length > 0) commitCellChange(forward, inverse, forward.length > 1 ? 'Edit cells' : 'Edit cell')
      return true
    },
    [readOnly, columns, data, commitCellChange, notify],
  )

  const onCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [col, row] = cell
      const column = columns[col]
      if (!column) return
      const rowData = data.getRow(row)
      if (!rowData) return
      const stored = rowData.cells[column.id]

      // Enrichment cell → open the provenance popover (never the type action).
      if (enrichCols.has(column.id) && onEnrichmentCellClick) {
        const enr = stored ? readEnrichment(stored.meta) : undefined
        if (enr) {
          const b = event.bounds
          onEnrichmentCellClick({ recordId: rowData.row.id, columnId: column.id }, { x: b.x, y: b.y, width: b.width, height: b.height })
          ;(event as { preventDefault?: () => void }).preventDefault?.()
          return
        }
      }

      // AI cell → open the AI provenance popover (Phase 3).
      if (aiCols.has(column.id) && onAiCellClick) {
        const ai = stored ? readAi(stored.meta) : undefined
        if (ai) {
          const b = event.bounds
          onAiCellClick({ recordId: rowData.row.id, columnId: column.id }, { x: b.x, y: b.y, width: b.width, height: b.height })
          ;(event as { preventDefault?: () => void }).preventDefault?.()
          return
        }
      }

      // Agent cell → open the agent provenance popover (Phase 3 rest).
      if (agentCols.has(column.id) && onAgentCellClick) {
        const ag = stored ? readAgent(stored.meta) : undefined
        if (ag) {
          const b = event.bounds
          onAgentCellClick({ recordId: rowData.row.id, columnId: column.id }, { x: b.x, y: b.y, width: b.width, height: b.height })
          ;(event as { preventDefault?: () => void }).preventDefault?.()
          return
        }
      }

      // HTTP cell → open the HTTP provenance popover (Phase 3 rest).
      if (httpCols.has(column.id) && onHttpCellClick) {
        const h = stored ? readHttp(stored.meta) : undefined
        if (h) {
          const b = event.bounds
          onHttpCellClick({ recordId: rowData.row.id, columnId: column.id }, { x: b.x, y: b.y, width: b.width, height: b.height })
          ;(event as { preventDefault?: () => void }).preventDefault?.()
          return
        }
      }

      if (column.type === 'boolean') {
        if (readOnly) {
          notify('Viewers have read-only access.')
          return
        }
        const prev = stored?.value ?? null
        const next = prev === true ? false : true
        commitCellChange(
          [{ recordId: rowData.row.id, columnId: column.id, value: next, expectedUpdatedAt: rowData.row.updatedAt }],
          [{ recordId: rowData.row.id, columnId: column.id, value: prev }],
          'Toggle checkbox',
        )
        ;(event as { preventDefault?: () => void }).preventDefault?.()
        return
      }

      if (column.type === 'url' || column.type === 'email') {
        const v = stored?.value
        if (typeof v === 'string' && v !== '') {
          const href = column.type === 'email' ? `mailto:${v}` : v
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }
    },
    [columns, data, readOnly, commitCellChange, enrichCols, onEnrichmentCellClick, aiCols, onAiCellClick, agentCols, onAgentCellClick, httpCols, onHttpCellClick, notify],
  )

  // --- copy / paste ------------------------------------------------------

  const handleCopy = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>) => {
      if (isEditingText()) return
      const range = selection.current?.range
      if (!range || range.width === 0 || range.height === 0) return
      const cells = getCellsForSelection(range)
      if (typeof cells === 'function') {
        // Off-screen rows — resolve asynchronously, then write via the async API.
        e.preventDefault()
        void cells().then((resolved) => {
          const tsv = toClipboard(cellsToStringGrid(resolved))
          navigator.clipboard?.writeText?.(tsv)
        })
        return
      }
      const tsv = toClipboard(cellsToStringGrid(cells))
      e.clipboardData?.setData('text/plain', tsv)
      e.preventDefault()
    },
    [selection, getCellsForSelection],
  )

  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>) => {
      if (isEditingText()) return // let the overlay editor receive the paste
      if (readOnly) {
        notify('Viewers have read-only access.')
        e.preventDefault()
        return
      }
      const range = selection.current?.range
      if (!range) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text === '') return
      e.preventDefault()
      const plan = planPaste(text, range, columns, data.rowCount, data.getRow)
      if (plan.forward.length > 0) {
        commitCellChange(plan.forward, plan.inverse, 'Paste')
        notify(
          plan.skipped > 0
            ? `Pasted ${plan.applied} cell${plan.applied === 1 ? '' : 's'}; skipped ${plan.skipped} that didn't fit or match the column type.`
            : null,
        )
      } else if (plan.skipped > 0) {
        notify('Nothing pasted — the values did not match the target columns.')
      }
    },
    [readOnly, selection, columns, data, commitCellChange, notify],
  )

  // --- row add / delete --------------------------------------------------

  const onRowAppended = useCallback(async (): Promise<undefined> => {
    if (readOnly) {
      notify('Viewers have read-only access.')
      return undefined
    }
    try {
      const added = await api.records.add(tableId, {})
      data.reload()
      const holder = { id: added.row.id, position: added.row.position }
      history.push({
        label: 'Add row',
        undo: () => api.records.bulkDelete(tableId, [holder.id]).then(() => data.reload()),
        redo: async () => {
          const re = await api.records.add(tableId, { position: holder.position })
          holder.id = re.row.id
          data.reload()
        },
      })
    } catch (err) {
      surface(err, 'Could not add a row.')
    }
    return undefined
  }, [api, tableId, data, readOnly, history, surface, notify])

  const deleteRowsAtIndices = useCallback(
    (rowIndices: number[]) => {
      const captured: { cells: Record<string, CellValue>; position: number }[] = []
      const ids: string[] = []
      for (const idx of rowIndices) {
        const rowData = data.getRow(idx)
        if (!rowData) continue // unloaded — can't resolve its record id
        ids.push(rowData.row.id)
        const cellVals: Record<string, CellValue> = {}
        for (const col of columns) {
          const st = rowData.cells[col.id]
          if (st) cellVals[col.id] = st.value
        }
        captured.push({ cells: cellVals, position: rowData.row.position })
      }
      if (ids.length === 0) return
      captured.sort((a, b) => a.position - b.position)
      const holder = { ids }

      const doDelete = () =>
        api.records
          .bulkDelete(tableId, holder.ids)
          .then(() => {
            data.reload()
            setSelection(EMPTY_SELECTION)
          })
      const doRestore = async () => {
        const newIds: string[] = []
        for (const rec of captured) {
          const added = await api.records.add(tableId, { cells: rec.cells, position: rec.position })
          newIds.push(added.row.id)
        }
        holder.ids = newIds
        data.reload()
      }

      doDelete().catch((err) => surface(err, 'Could not delete the selected rows.'))
      history.push({ label: ids.length > 1 ? 'Delete rows' : 'Delete row', undo: doRestore, redo: doDelete })
    },
    [api, tableId, data, columns, history, surface],
  )

  // Delete key: when whole rows are selected, remove them via the API (and keep
  // it undoable); otherwise let Glide clear the cell range (routed back through
  // onCellsEdited, so clears are undoable too).
  const onDelete = useCallback(
    (sel: GridSelection): boolean => {
      if (readOnly) {
        notify('Viewers have read-only access.')
        return false
      }
      if (sel.rows.length > 0) {
        deleteRowsAtIndices(sel.rows.toArray())
        return false
      }
      return true
    },
    [readOnly, deleteRowsAtIndices, notify],
  )

  // --- undo / redo shortcuts + imperative handle -------------------------

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Enter / Space on a resolved provenance cell opens its popover, so the
      // provenance is reachable without a mouse (keyboard access). We fall
      // through to Glide's native handling when the active cell isn't one.
      if ((e.key === 'Enter' || e.key === ' ') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditingText()) return
        const pos = selection.current?.cell
        if (!pos) return
        const [col, row] = pos
        const column = columns[col]
        const rowData = data.getRow(row)
        if (!column || !rowData) return
        const stored = rowData.cells[column.id]
        if (!stored) return
        const b = editorRef.current?.getBounds(col, row)
        if (!b) return
        const rect: CellRect = { x: b.x, y: b.y, width: b.width, height: b.height }
        const cref = { recordId: rowData.row.id, columnId: column.id }
        if (enrichCols.has(column.id) && onEnrichmentCellClick && readEnrichment(stored.meta)) {
          e.preventDefault()
          onEnrichmentCellClick(cref, rect)
        } else if (aiCols.has(column.id) && onAiCellClick && readAi(stored.meta)) {
          e.preventDefault()
          onAiCellClick(cref, rect)
        } else if (agentCols.has(column.id) && onAgentCellClick && readAgent(stored.meta)) {
          e.preventDefault()
          onAgentCellClick(cref, rect)
        } else if (httpCols.has(column.id) && onHttpCellClick && readHttp(stored.meta)) {
          e.preventDefault()
          onHttpCellClick(cref, rect)
        }
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      if (isEditingText()) return // don't hijack the overlay editor's native undo
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      } else if (key === 'y') {
        e.preventDefault()
        history.redo()
      }
    },
    [history, selection, columns, data, enrichCols, aiCols, agentCols, httpCols, onEnrichmentCellClick, onAiCellClick, onAgentCellClick, onHttpCellClick],
  )

  const handle = useMemo<TableGridHandle>(
    () => ({
      undo: history.undo,
      redo: history.redo,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      applyEnrichment: data.applyEnrichment,
      applyAi: data.applyAi,
      applyAgent: data.applyAgent,
      applyHttp: data.applyHttp,
    }),
    [history.undo, history.redo, history.canUndo, history.canRedo, data.applyEnrichment, data.applyAi, data.applyAgent, data.applyHttp],
  )
  useImperativeHandle(ref, () => handle, [handle])
  // next/dynamic can't forward refs, so also surface the handle to the parent via
  // onReady — used to drive live per-cell enrichment updates imperatively.
  useEffect(() => {
    onReady?.(handle)
    return () => onReady?.(null)
  }, [handle, onReady])

  // --- windowing, resize -------------------------------------------------

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      data.ensureRange(range.y, range.y + range.height)
    },
    [data],
  )

  // During the drag, only track the width locally (one setState per tick). The
  // API persistence is deferred to onColumnResizeEnd so we write once on release
  // instead of firing api.columns.update on every resize tick.
  const onColumnResize = useCallback((column: GridColumn, newSize: number) => {
    const id = column.id
    if (!id) return
    setWidths((w) => ({ ...w, [id]: newSize }))
  }, [])

  const onColumnResizeEnd = useCallback(
    (column: GridColumn, newSize: number) => {
      const id = column.id
      if (!id) return
      setWidths((w) => ({ ...w, [id]: newSize }))
      if (!readOnly) api.columns.update(id, { width: newSize }).catch(() => {})
    },
    [api, readOnly],
  )

  // Wrap selection so the parent learns which record ids are selected (for
  // "run selected rows"). Both whole-row markers and a cell range contribute.
  const handleSelectionChange = useCallback(
    (sel: GridSelection) => {
      setSelection(sel)
      if (!onSelectionChange) return
      const idxs = new Set<number>(sel.rows.toArray())
      const range = sel.current?.range
      if (range) for (let y = range.y; y < range.y + range.height; y += 1) idxs.add(y)
      const ids: string[] = []
      for (const i of idxs) {
        const r = data.getRow(i)
        if (r) ids.push(r.row.id)
      }
      onSelectionChange({ recordIds: ids, rowCount: ids.length, hasRange: !!range && range.height > 0 })
    },
    [onSelectionChange, data],
  )

  // Coarse refresh: drop the cache and re-read after a run terminal / config
  // change (live per-cell transitions use the imperative applyEnrichment).
  // Guard on the last-seen token value (not a "first run" flag) so React
  // StrictMode's double-invoked mount effect can't fire a spurious reload — a
  // reload during the initial load races the mount's count and blanks the grid.
  const lastRefresh = useRef(refreshToken)
  useEffect(() => {
    if (lastRefresh.current === refreshToken) return
    lastRefresh.current = refreshToken
    data.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const ready = columns.length > 0 && data.ready

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
    >
      {warning && (
        <div className={styles.warning} role={warningAlert ? 'alert' : 'status'}>
          <span>{warning}</span>
          <button type="button" className={styles.dismiss} onClick={() => notify(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <div className={styles.grid}>
        {!readOnly && (
          <HistoryControls
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
            undoLabel={history.state.undoLabel}
            redoLabel={history.state.redoLabel}
          />
        )}
        {ready && (
          <DataEditor
            ref={editorRef}
            theme={theme}
            customRenderers={cascadeCellRenderers}
            getCellContent={getCellContent}
            columns={gridColumns}
            rows={data.rowCount}
            rowHeight={ROW_HEIGHT}
            headerHeight={HEADER_HEIGHT}
            freezeColumns={freezeColumns}
            rowMarkers="both"
            smoothScrollX
            smoothScrollY
            width="100%"
            height="100%"
            keybindings={KEYBINDINGS}
            gridSelection={selection}
            onGridSelectionChange={handleSelectionChange}
            getCellsForSelection={getCellsForSelection}
            onPaste={false}
            onDelete={onDelete}
            onCellsEdited={onCellsEdited}
            onCellClicked={onCellClicked}
            onColumnResize={onColumnResize}
            onColumnResizeEnd={onColumnResizeEnd}
            onVisibleRegionChanged={onVisibleRegionChanged}
            trailingRowOptions={readOnly ? undefined : { hint: 'New row', sticky: true }}
            onRowAppended={readOnly ? undefined : onRowAppended}
          />
        )}
      </div>
    </div>
  )
})
