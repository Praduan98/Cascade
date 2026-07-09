// Typed filter model + evaluator. A filter is a tree of conditions grouped by
// AND / OR. Operators come from the column-type registry, so a condition is
// always type-appropriate for its column.

import type { CellValue, Column } from './types'
import { columnTypeRegistry } from './columnTypes'

export interface FilterCondition {
  columnId: string
  /** Operator id from the column type's `filterOperators`. */
  op: string
  /** Operand for the operator; omitted/ignored for unary operators. */
  operand?: unknown
}

export interface FilterGroup {
  conjunction: 'and' | 'or'
  items: (FilterCondition | FilterGroup)[]
}

export function isFilterGroup(item: FilterCondition | FilterGroup): item is FilterGroup {
  return (item as FilterGroup).conjunction !== undefined && Array.isArray((item as FilterGroup).items)
}

export function emptyFilter(): FilterGroup {
  return { conjunction: 'and', items: [] }
}

/** A record's values, keyed by columnId. Missing keys are treated as empty. */
export type CellValuesByColumn = Record<string, CellValue>

export function evaluateCondition(
  cond: FilterCondition,
  cellsByColumn: CellValuesByColumn,
  columnsById: Record<string, Column>,
): boolean {
  const col = columnsById[cond.columnId]
  if (!col) return true // unknown column → don't exclude the row
  const def = columnTypeRegistry[col.type]
  const op = def.filterOperators.find((o) => o.id === cond.op)
  if (!op) return true // unknown operator → no-op
  const value = cond.columnId in cellsByColumn ? cellsByColumn[cond.columnId] ?? null : null
  return op.apply(value, cond.operand)
}

/** Recursively evaluate a filter group against one record's cell values. */
export function evaluateFilter(
  cellsByColumn: CellValuesByColumn,
  group: FilterGroup,
  columnsById: Record<string, Column>,
): boolean {
  if (!group.items.length) return true
  const results = group.items.map((item) =>
    isFilterGroup(item)
      ? evaluateFilter(cellsByColumn, item, columnsById)
      : evaluateCondition(item, cellsByColumn, columnsById),
  )
  return group.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean)
}

/** True when the group (recursively) contains no conditions. */
export function isFilterEmpty(group: FilterGroup): boolean {
  return group.items.every((item) => (isFilterGroup(item) ? isFilterEmpty(item) : false))
}
