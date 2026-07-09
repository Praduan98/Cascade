// Pure helpers backing the filter builder. Keeps FilterPopover focused on
// rendering: everything that reasons about a condition's shape (which operand a
// column-type + operator needs, sensible defaults, extracting the flat list of
// conditions from a FilterGroup) lives here and is unit-testable in isolation.

import {
  columnTypeRegistry,
  isFilterGroup,
  type Column,
  type FilterCondition,
  type FilterGroup,
  type FilterOperator,
} from '@cascade/core'

/** The kind of operand editor a (column type, operator) pair requires. */
export type OperandKind =
  | 'none' // unary operator — no operand
  | 'text'
  | 'number'
  | 'numberRange'
  | 'date'
  | 'dateRange'
  | 'boolean'
  | 'selectOne'
  | 'selectMany'

const NUMERIC = new Set(['number', 'currency'])
const SELECT_MANY_OPS = new Set(['isAnyOf', 'isNoneOf', 'hasAnyOf', 'hasAllOf', 'hasNoneOf'])

/** Operators available for a column, straight from the type registry. */
export function operatorsFor(col: Column): FilterOperator[] {
  return columnTypeRegistry[col.type].filterOperators
}

export function findOperator(col: Column, opId: string): FilterOperator | undefined {
  return operatorsFor(col).find((o) => o.id === opId)
}

/** Which operand editor a condition needs, given its column and operator. */
export function operandKind(col: Column, op: FilterOperator | undefined): OperandKind {
  if (!op || op.unary) return 'none'
  if (col.type === 'boolean') return 'boolean' // the only binary boolean op is "is"
  if (NUMERIC.has(col.type)) return op.id === 'between' ? 'numberRange' : 'number'
  if (col.type === 'date') return op.id === 'between' ? 'dateRange' : 'date'
  if (col.type === 'singleSelect') return SELECT_MANY_OPS.has(op.id) ? 'selectMany' : 'selectOne'
  if (col.type === 'multiSelect') return 'selectMany'
  return 'text'
}

/** A blank operand appropriate for a freshly-selected operand kind. */
export function defaultOperand(kind: OperandKind): unknown {
  switch (kind) {
    case 'none':
      return undefined
    case 'text':
      return ''
    case 'number':
    case 'date':
      return null
    case 'numberRange':
    case 'dateRange':
      return [null, null]
    case 'boolean':
      return true
    case 'selectOne':
      return null
    case 'selectMany':
      return []
  }
}

/** Build a condition for a column defaulting to its first operator. */
export function makeCondition(col: Column): FilterCondition {
  const op = operatorsFor(col)[0]
  const kind = operandKind(col, op)
  const operand = defaultOperand(kind)
  const cond: FilterCondition = { columnId: col.id, op: op?.id ?? 'contains' }
  if (operand !== undefined) cond.operand = operand
  return cond
}

/** Flatten a group to just its top-level conditions (Phase-1 filters are flat). */
export function conditionsOf(group: FilterGroup): FilterCondition[] {
  return group.items.filter((i): i is FilterCondition => !isFilterGroup(i))
}

/** Re-assemble a FilterGroup from a conjunction and a flat condition list. */
export function toGroup(conjunction: 'and' | 'or', conditions: FilterCondition[]): FilterGroup {
  return { conjunction, items: conditions }
}
