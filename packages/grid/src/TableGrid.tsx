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
import type { CellValue, Column } from '@cascade/core'
import { toClipboard, validateValue } from '@cascade/core'
import { useGlideTheme } from './useGlideTheme'
import { useTableData } from './dataProvider'
import { cascadeCellRenderers, makeCell, makeStatusCell, rawFromCell } from './cells'
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

/** Imperative handle so a parent can drive/relocate the undo-redo controls. */
export interface TableGridHandle {
  undo: () => void
  redo: () => void
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export interface TableGridProps {
  tableId: string
  /** Active view — drives filter/sort (and, later, column visibility). */
  viewId?: string
  /** API to read/write through. Defaults to the app-wide singleton. */
  api?: CascadeApi
  /** UI-level read-only gate (Viewer role). Server-side enforcement is separate. */
  readOnly?: boolean
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
  { tableId, viewId, api: apiProp, readOnly = false, onHistoryChange, className },
  ref,
) {
  const api = useMemo(() => apiProp ?? getApi(), [apiProp])
  const theme = useGlideTheme()
  const editorRef = useRef<DataEditorRef>(null)
  const [warning, setWarning] = useState<string | null>(null)

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
        if (!cancelled) setWarning('Could not load columns.')
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
    () => columns.map((c) => ({ id: c.id, title: c.name, width: widths[c.id] ?? c.width })),
    [columns, widths],
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
      const value: CellValue = stored ? stored.value : column.type === 'multiSelect' ? [] : null
      return makeCell(column, value)
    },
    [columns, data],
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
    [api, columns, data, tableId, viewId],
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
            setWarning('Some cells changed since you loaded them and were not overwritten.')
          } else {
            setWarning(null)
          }
        })
        .catch((err: unknown) => {
          if (err instanceof ConflictError) setWarning('That value changed since you loaded it.')
          else if (isApiError(err)) setWarning(err.message)
          else setWarning('Could not save your edit.')
          data.reload()
        })
    },
    [api, data],
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
    setWarning(isApiError(err) ? err.message : fallback)
  }, [])

  // --- editing -----------------------------------------------------------

  const onCellsEdited = useCallback(
    (edits: readonly EditListItem[]): boolean => {
      if (readOnly) {
        setWarning('Viewers have read-only access.')
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
          setWarning(res.error)
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
    [readOnly, columns, data, commitCellChange],
  )

  const onCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [col, row] = cell
      const column = columns[col]
      if (!column) return
      const rowData = data.getRow(row)
      if (!rowData) return
      const stored = rowData.cells[column.id]

      if (column.type === 'boolean') {
        if (readOnly) {
          setWarning('Viewers have read-only access.')
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
    [columns, data, readOnly, commitCellChange],
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
        setWarning('Viewers have read-only access.')
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
        setWarning(
          plan.skipped > 0
            ? `Pasted ${plan.applied} cell${plan.applied === 1 ? '' : 's'}; skipped ${plan.skipped} that didn't fit or match the column type.`
            : null,
        )
      } else if (plan.skipped > 0) {
        setWarning('Nothing pasted — the values did not match the target columns.')
      }
    },
    [readOnly, selection, columns, data, commitCellChange],
  )

  // --- row add / delete --------------------------------------------------

  const onRowAppended = useCallback(async (): Promise<undefined> => {
    if (readOnly) {
      setWarning('Viewers have read-only access.')
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
  }, [api, tableId, data, readOnly, history, surface])

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
        setWarning('Viewers have read-only access.')
        return false
      }
      if (sel.rows.length > 0) {
        deleteRowsAtIndices(sel.rows.toArray())
        return false
      }
      return true
    },
    [readOnly, deleteRowsAtIndices],
  )

  // --- undo / redo shortcuts + imperative handle -------------------------

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
    [history],
  )

  useImperativeHandle(
    ref,
    (): TableGridHandle => ({
      undo: history.undo,
      redo: history.redo,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }),
    [history.undo, history.redo, history.canUndo, history.canRedo],
  )

  // --- windowing, resize -------------------------------------------------

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      data.ensureRange(range.y, range.y + range.height)
    },
    [data],
  )

  const onColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      const id = column.id
      if (!id) return
      setWidths((w) => ({ ...w, [id]: newSize }))
      if (!readOnly) api.columns.update(id, { width: newSize }).catch(() => {})
    },
    [api, readOnly],
  )

  const ready = columns.length > 0 && data.ready

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
    >
      {warning && (
        <div className={styles.warning} role="status">
          <span>{warning}</span>
          <button type="button" className={styles.dismiss} onClick={() => setWarning(null)} aria-label="Dismiss">
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
            onGridSelectionChange={setSelection}
            getCellsForSelection={getCellsForSelection}
            onPaste={false}
            onDelete={onDelete}
            onCellsEdited={onCellsEdited}
            onCellClicked={onCellClicked}
            onColumnResize={onColumnResize}
            onVisibleRegionChanged={onVisibleRegionChanged}
            trailingRowOptions={readOnly ? undefined : { hint: 'New row', sticky: true }}
            onRowAppended={readOnly ? undefined : onRowAppended}
          />
        )}
      </div>
    </div>
  )
})
