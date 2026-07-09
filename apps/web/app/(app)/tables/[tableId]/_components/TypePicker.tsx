'use client'
// The 11-type picker used by the add- and edit-column dialogs. Reads labels and
// mono type badges straight from the core column-type registry so it stays in
// lockstep with the single source of truth.

import { COLUMN_TYPES, getColumnType } from '@cascade/core'
import type { ColumnType } from '@cascade/core'
import styles from '../column-tools.module.css'

interface Props {
  value: ColumnType
  onChange: (type: ColumnType) => void
  disabled?: boolean
}

export function TypePicker({ value, onChange, disabled }: Props) {
  return (
    <div className={styles.typeGrid} role="radiogroup" aria-label="Column type">
      {COLUMN_TYPES.map((t) => {
        const def = getColumnType(t)
        const active = t === value
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
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
