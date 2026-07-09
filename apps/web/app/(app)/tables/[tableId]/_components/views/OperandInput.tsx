'use client'
// Renders the operand editor for one filter condition, chosen from the column's
// type and the selected operator (via operandKind). Emits the operand in the
// exact shape the core evaluator expects: strings for text, numbers for numeric,
// ISO strings for dates, option ids for selects, tuples for ranges.

import { Input, Select } from '@cascade/ui'
import type { Column, MultiSelectConfig, SelectOption, SingleSelectConfig } from '@cascade/core'
import { operandKind, type OperandKind } from './filterModel'
import type { FilterOperator } from '@cascade/core'
import styles from './views.module.css'

interface Props {
  column: Column
  operator: FilterOperator | undefined
  operand: unknown
  onChange: (operand: unknown) => void
  disabled?: boolean
}

function optionsOf(column: Column): SelectOption[] {
  if (column.type === 'singleSelect') return (column.config as SingleSelectConfig).options
  if (column.type === 'multiSelect') return (column.config as MultiSelectConfig).options
  return []
}

function asPair(operand: unknown): [unknown, unknown] {
  return Array.isArray(operand) ? [operand[0] ?? null, operand[1] ?? null] : [null, null]
}

export function OperandInput({ column, operator, operand, onChange, disabled = false }: Props) {
  const kind: OperandKind = operandKind(column, operator)

  if (kind === 'none') return null

  if (kind === 'text') {
    return (
      <Input
        className={styles.grow}
        placeholder="Value"
        disabled={disabled}
        value={typeof operand === 'string' ? operand : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  if (kind === 'number') {
    return (
      <Input
        className={styles.grow}
        type="number"
        placeholder="0"
        disabled={disabled}
        value={typeof operand === 'number' ? String(operand) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  }

  if (kind === 'date') {
    return (
      <Input
        className={styles.grow}
        type="date"
        disabled={disabled}
        value={typeof operand === 'string' ? operand : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    )
  }

  if (kind === 'numberRange' || kind === 'dateRange') {
    const [a, b] = asPair(operand)
    const type = kind === 'dateRange' ? 'date' : 'number'
    const val = (v: unknown) => (kind === 'dateRange' ? (typeof v === 'string' ? v : '') : typeof v === 'number' ? String(v) : '')
    const parse = (raw: string) => (raw === '' ? null : kind === 'dateRange' ? raw : Number(raw))
    return (
      <div className={styles.operand}>
        <Input
          type={type}
          placeholder={kind === 'dateRange' ? undefined : 'Min'}
          disabled={disabled}
          value={val(a)}
          onChange={(e) => onChange([parse(e.target.value), b])}
        />
        <span className={styles.rangeSep}>and</span>
        <Input
          type={type}
          placeholder={kind === 'dateRange' ? undefined : 'Max'}
          disabled={disabled}
          value={val(b)}
          onChange={(e) => onChange([a, parse(e.target.value)])}
        />
      </div>
    )
  }

  if (kind === 'boolean') {
    return (
      <Select
        className={styles.grow}
        disabled={disabled}
        value={operand === false ? 'false' : 'true'}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </Select>
    )
  }

  if (kind === 'selectOne') {
    const options = optionsOf(column)
    return (
      <Select
        className={styles.grow}
        disabled={disabled}
        value={typeof operand === 'string' ? operand : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    )
  }

  // selectMany — toggleable option chips.
  const options = optionsOf(column)
  const selected = new Set(Array.isArray(operand) ? operand.map(String) : [])
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }
  if (options.length === 0) {
    return <span className={styles.optNone}>No options defined</span>
  }
  return (
    <div className={styles.optChips}>
      {options.map((o) => {
        const on = selected.has(o.id)
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            className={[styles.optChip, on ? styles.on : ''].filter(Boolean).join(' ')}
            style={on ? { background: o.color, borderColor: o.color } : undefined}
            aria-pressed={on}
            onClick={() => toggle(o.id)}
          >
            {!on && <span className={styles.optDot} style={{ background: o.color }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
