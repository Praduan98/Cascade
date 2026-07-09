// Multi-column, type-aware sorting. Numeric columns sort numerically, dates
// chronologically, selects by their defined option order, and everything else
// by locale-aware string comparison. Empty cells always sort last.

import type { CellValue, Column, MultiSelectConfig, SingleSelectConfig } from './types'
import { columnTypeRegistry } from './columnTypes'
import type { CellValuesByColumn } from './filters'

export interface SortSpec {
  columnId: string
  dir: 'asc' | 'desc'
}

function isEmptyFor(col: Column, value: CellValue): boolean {
  return columnTypeRegistry[col.type].isEmpty(value)
}

/** Base ascending comparison for two non-empty values of a given column. */
function compareBase(col: Column, a: CellValue, b: CellValue): number {
  switch (col.type) {
    case 'number':
    case 'currency': {
      const na = typeof a === 'number' ? a : Number.NEGATIVE_INFINITY
      const nb = typeof b === 'number' ? b : Number.NEGATIVE_INFINITY
      return na === nb ? 0 : na < nb ? -1 : 1
    }
    case 'boolean': {
      const na = a === true ? 1 : 0
      const nb = b === true ? 1 : 0
      return na - nb
    }
    case 'date': {
      const sa = typeof a === 'string' ? a : ''
      const sb = typeof b === 'string' ? b : ''
      return sa === sb ? 0 : sa < sb ? -1 : 1
    }
    case 'singleSelect': {
      const options = (col.config as SingleSelectConfig).options
      const ia = options.findIndex((o) => o.id === a)
      const ib = options.findIndex((o) => o.id === b)
      if (ia !== ib) return ia - ib
      return 0
    }
    case 'multiSelect': {
      const options = (col.config as MultiSelectConfig).options
      const key = (v: CellValue) =>
        Array.isArray(v)
          ? v.map((id) => options.find((o) => o.id === id)?.label ?? '').join(', ')
          : ''
      return key(a).localeCompare(key(b))
    }
    default: {
      // text, longText, url, email, phone
      const sa = typeof a === 'string' ? a : String(a ?? '')
      const sb = typeof b === 'string' ? b : String(b ?? '')
      return sa.localeCompare(sb, undefined, { sensitivity: 'base', numeric: true })
    }
  }
}

/**
 * Build a comparator over records represented as { columnId → value } maps.
 * Applies each sort in priority order; empties sort last regardless of dir.
 */
export function makeComparator(
  sorts: SortSpec[],
  columnsById: Record<string, Column>,
): (a: CellValuesByColumn, b: CellValuesByColumn) => number {
  const active = sorts
    .map((s) => ({ spec: s, col: columnsById[s.columnId] }))
    .filter((x): x is { spec: SortSpec; col: Column } => x.col !== undefined)

  return (rowA, rowB) => {
    for (const { spec, col } of active) {
      const va = rowA[col.id] ?? null
      const vb = rowB[col.id] ?? null
      const ea = isEmptyFor(col, va)
      const eb = isEmptyFor(col, vb)
      if (ea && eb) continue
      if (ea) return 1 // empty A sorts after non-empty B
      if (eb) return -1
      const base = compareBase(col, va, vb)
      if (base !== 0) return spec.dir === 'asc' ? base : -base
    }
    return 0
  }
}
