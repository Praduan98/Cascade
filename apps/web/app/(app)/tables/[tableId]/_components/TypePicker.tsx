'use client'
// The 11-type picker used by the add- and edit-column dialogs. Reads labels and
// mono type badges straight from the core column-type registry so it stays in
// lockstep with the single source of truth.

import { useRef, type KeyboardEvent } from 'react'
import { COLUMN_TYPES, getColumnType } from '@cascade/core'
import type { ColumnType } from '@cascade/core'
import styles from '../column-tools.module.css'

interface Props {
  value: ColumnType
  onChange: (type: ColumnType) => void
  disabled?: boolean
}

const NAV_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'] as const

export function TypePicker({ value, onChange, disabled }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)

  // Arrow-key roving through the radiogroup: move selection and focus together,
  // wrapping at the ends, matching the WAI-ARIA radio pattern.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !(NAV_KEYS as readonly string[]).includes(e.key)) return
    e.preventDefault()
    const idx = COLUMN_TYPES.indexOf(value)
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const nextIdx = (idx + delta + COLUMN_TYPES.length) % COLUMN_TYPES.length
    const next = COLUMN_TYPES[nextIdx]
    if (!next) return
    onChange(next)
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[nextIdx]?.focus()
  }

  return (
    <div ref={gridRef} className={styles.typeGrid} role="radiogroup" aria-label="Column type" onKeyDown={onKeyDown}>
      {COLUMN_TYPES.map((t) => {
        const def = getColumnType(t)
        const active = t === value
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={[styles.typeBtn, active ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(t)}
            disabled={disabled}
          >
            <span className={styles.typeBadge}>{def.typeBadge}</span>
            <span className={styles.typeLabel}>{def.label}</span>
          </button>
        )
      })}
    </div>
  )
}
