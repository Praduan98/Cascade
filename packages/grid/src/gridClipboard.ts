// Pure clipboard helpers for the grid's copy/paste interaction layer. Kept
// framework-free (no React, no Glide runtime — only types) so the mapping logic
// is easy to reason about and reuse.
//
//  • cellsToStringGrid — turns the `CellArray` that `getCellsForSelection`
//    returns (each cell carries a `copyData` string produced via the core
//    column-type registry) into a 2-D string grid ready for `toClipboard`.
//  • planPaste — parses TSV/CSV (incl. quoted multi-line via core
//    `parseClipboard`), maps it onto a target range, coerces + validates each
//    value against the TARGET column type, and returns the forward patches plus
//    their inverse (previous values) so the paste is a single undoable command.

import type { CellArray } from '@glideapps/glide-data-grid'
import type { CellEdit } from '@cascade/data'
import type { CellValue, Column, RowWithCells } from '@cascade/core'
import { parseClipboard, validateValue } from '@cascade/core'

/** A rectangular target in grid coordinates (columns × rows). */
export interface PasteRange {
  x: number
  y: number
  width: number
  height: number
}

export interface PastePlan {
  /** Validated patches to persist. */
  forward: CellEdit[]
  /** Previous values, one per forward patch, for undo. */
  inverse: CellEdit[]
  /** Count of cells that will change. */
  applied: number
  /** Count of clipboard cells dropped (out of bounds or type mismatch). */
  skipped: number
}

const emptyValue = (column: Column): CellValue => (column.type === 'multiSelect' ? [] : null)

/** Extract each cell's `copyData` into a 2-D string grid (for `toClipboard`). */
export function cellsToStringGrid(cells: CellArray): string[][] {
  return cells.map((row) => row.map((cell) => (cell as { copyData?: string }).copyData ?? ''))
}

/**
 * Build the paste plan. `getRow` reads the windowed cache; rows not loaded (or
 * beyond the row count) are skipped rather than guessed. A 1×1 clipboard fills
 * the whole target range (spreadsheet convention); otherwise the clipboard grid
 * is mapped from the range's top-left.
 */
export function planPaste(
  text: string,
  range: PasteRange,
  columns: Column[],
  rowCount: number,
  getRow: (row: number) => RowWithCells | undefined,
): PastePlan {
  const grid = parseClipboard(text)
  const forward: CellEdit[] = []
  const inverse: CellEdit[] = []
  let skipped = 0
  if (grid.length === 0) return { forward, inverse, applied: 0, skipped: 0 }

  const single = grid.length === 1 && (grid[0]?.length ?? 0) === 1
  const singleValue = single ? grid[0]![0]! : ''
  const nRows = single ? Math.max(1, range.height) : grid.length

  for (let r = 0; r < nRows; r += 1) {
    const gy = range.y + r
    if (gy >= rowCount) break
    const rowData = getRow(gy)
    const nCols = single ? Math.max(1, range.width) : grid[r]?.length ?? 0
    for (let c = 0; c < nCols; c += 1) {
      const gx = range.x + c
      const column = columns[gx]
      if (!column) {
        skipped += 1
        continue
      }
      if (!rowData) {
        // Target row isn't in the windowed cache — can't resolve its record id.
        skipped += 1
        continue
      }
      const raw = single ? singleValue : grid[r]?.[c] ?? ''
      const res = validateValue(column.type, raw, column.config)
      if (!res.ok) {
        skipped += 1
        continue
      }
      const prev = rowData.cells[column.id]?.value ?? emptyValue(column)
      forward.push({
        recordId: rowData.row.id,
        columnId: column.id,
        value: res.value,
        expectedUpdatedAt: rowData.row.updatedAt,
      })
      inverse.push({ recordId: rowData.row.id, columnId: column.id, value: prev })
    }
  }

  return { forward, inverse, applied: forward.length, skipped }
}
