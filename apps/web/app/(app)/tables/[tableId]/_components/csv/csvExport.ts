// Export the current view to CSV. Visible columns in view order, values rendered
// through the column-type registry's `toCsv` (multi-select uses the documented
// ", " delimiter), then serialised RFC-4180 via core's `toCsv`. Fetching goes
// through getApi().records.list with the active viewId, so the export already
// reflects the view's filters + sort (applied server-side). Column visibility +
// order live in the view's columnState and are applied here, mirroring how the
// grid derives its visible fields.

import { getColumnType, toCsv as rowsToCsv } from '@cascade/core'
import type { Column, RowWithCells, View } from '@cascade/core'
import { getApi } from '@cascade/data'

/** Rows fetched per page when streaming a large view out to CSV. */
export const EXPORT_PAGE_SIZE = 1000

/**
 * The columns a view actually shows, in the order it shows them. Seeded from the
 * view's columnState (visible + position), then reconciled against the live
 * column set so any column missing from the saved state is treated as visible
 * and appended in its natural position order. With no active view, every column
 * is exported in position order.
 */
export function visibleColumnsForView(columns: Column[], view: View | undefined): Column[] {
  const ordered = columns.slice().sort((a, b) => a.position - b.position)
  if (!view) return ordered

  const byId = new Map(ordered.map((c) => [c.id, c]))
  const state = view.columnState ?? []
  const known = new Set(state.map((s) => s.columnId))

  const shown: Column[] = []
  for (const s of state.slice().sort((a, b) => a.position - b.position)) {
    if (!s.visible) continue
    const col = byId.get(s.columnId)
    if (col) shown.push(col)
  }
  // Columns the saved state never mentioned are visible by default.
  for (const col of ordered) {
    if (!known.has(col.id)) shown.push(col)
  }
  return shown
}

/** Build the 2-D string grid (header row + one row per record) for a set of columns. */
export function buildCsvGrid(cols: Column[], rows: RowWithCells[]): string[][] {
  const header = cols.map((c) => c.name)
  const body = rows.map((r) =>
    cols.map((c) => {
      const cell = r.cells[c.id]
      const value = cell ? cell.value : c.type === 'multiSelect' ? [] : null
      return getColumnType(c.type).toCsv(value, c.config)
    }),
  )
  return [header, ...body]
}

/**
 * Read every record in the active view (paged so a large table never lands in
 * one response) and return the complete RFC-4180 CSV text.
 */
export async function exportViewToCsv(tableId: string, cols: Column[], viewId?: string): Promise<string> {
  const api = getApi()
  const all: RowWithCells[] = []
  let offset = 0
  // First page also gives us the filtered total to page against.
  for (;;) {
    const res = await api.records.list(tableId, { viewId, offset, limit: EXPORT_PAGE_SIZE })
    all.push(...res.rows)
    offset += res.rows.length
    if (res.rows.length === 0 || offset >= res.total) break
  }
  return rowsToCsv(buildCsvGrid(cols, all))
}

/** Trigger a client-side download of `csv` as `filename` (BOM-prefixed for Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const BOM = '﻿' // helps Excel detect UTF-8
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A filesystem-friendly CSV filename derived from the table + view names. */
export function exportFilename(tableName: string, viewName?: string): string {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase() || 'table'
  const base = viewName && viewName.trim() ? `${slug(tableName)}-${slug(viewName)}` : slug(tableName)
  const stamp = new Date().toISOString().slice(0, 10)
  return `${base}-${stamp}.csv`
}
