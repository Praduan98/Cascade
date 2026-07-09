'use client'
// TableGrid — the Glide DataEditor host. Wires the token→canvas theme, the 11
// typed custom cell renderers + StatusCell, the windowed data provider, frozen
// columns, row markers, a persistent add-row, and optimistic inline editing
// (with last-write-wins conflict surfacing). Copy/paste + undo/redo are minimal
// seams in Phase 1; the full interaction layer lands in a later stage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import type {
  CellClickedEventArgs,
  DataEditorRef,
  EditListItem,
  GridCell,
  GridColumn,
  Item,
  Rectangle,
} from '@glideapps/glide-data-grid'
import { ConflictError, getApi, isApiError } from '@cascade/data'
import type { CascadeApi, CellEdit } from '@cascade/data'
import type { CellValue, Column } from '@cascade/core'
import { validateValue } from '@cascade/core'
import { useGlideTheme } from './useGlideTheme'
import { useTableData } from './dataProvider'
import { cascadeCellRenderers, makeCell, makeStatusCell, rawFromCell } from './cells'
import type { CascadeCell } from './cells'
import './glideStyles'
import styles from './TableGrid.module.css'

const ROW_HEIGHT = 38
const HEADER_HEIGHT = 38

export interface TableGridProps {
  tableId: string
  /** Active view — drives filter/sort (and, later, column visibility). */
  viewId?: string
  /** API to read/write through. Defaults to the app-wide singleton. */
  api?: CascadeApi
  /** UI-level read-only gate (Viewer role). Server-side enforcement is separate. */
  readOnly?: boolean
  className?: string
}

export function TableGrid({ tableId, viewId, api: apiProp, readOnly = false, className }: TableGridProps) {
  const api = useMemo(() => apiProp ?? getApi(), [apiProp])
  const theme = useGlideTheme()
  const editorRef = useRef<DataEditorRef>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const [columns, setColumns] = useState<Column[]>([])
  const [widths, setWidths] = useState<Record<string, number>>({})

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

  // --- editing -----------------------------------------------------------

  // Apply a set of validated patches optimistically, then reconcile with the
  // server (updated timestamps + last-write-wins conflicts).
  const commit = useCallback(
    (patches: CellEdit[]) => {
      const now = new Date().toISOString()
      for (const p of patches) data.applyEdit(p.recordId, p.columnId, p.value, p.expectedUpdatedAt ?? now)
      api.cells
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

  const onCellsEdited = useCallback(
    (edits: readonly EditListItem[]): boolean => {
      if (readOnly) {
        setWarning('Viewers have read-only access.')
        return true
      }
      const patches: CellEdit[] = []
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
        patches.push({
          recordId: rowData.row.id,
          columnId: column.id,
          value: res.value,
          expectedUpdatedAt: rowData.row.updatedAt,
        })
      }
      if (patches.length > 0) commit(patches)
      return true
    },
    [readOnly, columns, data, commit],
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
        const next = stored?.value === true ? false : true
        commit([
          { recordId: rowData.row.id, columnId: column.id, value: next, expectedUpdatedAt: rowData.row.updatedAt },
        ])
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
    [columns, data, readOnly, commit],
  )

  // --- windowing, resize, add-row ---------------------------------------

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

  const onRowAppended = useCallback(async (): Promise<undefined> => {
    if (readOnly) {
      setWarning('Viewers have read-only access.')
      return undefined
    }
    try {
      await api.records.add(tableId, {})
      data.reload()
    } catch {
      setWarning('Could not add a row.')
    }
    return undefined
  }, [api, tableId, data, readOnly])

  const ready = columns.length > 0 && data.ready

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      {warning && (
        <div className={styles.warning} role="status">
          <span>{warning}</span>
          <button type="button" className={styles.dismiss} onClick={() => setWarning(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <div className={styles.grid}>
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
            // Enables Ctrl/Cmd+C over a selection using each cell's copyData.
            getCellsForSelection
            // Paste + undo/redo are wired in the interaction stage; ignore for now.
            onPaste={false}
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
}
