'use client'
import type { ReactNode } from 'react'
import styles from './Seg.module.css'

export interface SegOption<T extends string> {
  value: T
  label: ReactNode
}

interface SegProps<T extends string> {
  options: SegOption<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label'?: string
}

// Ported from design-system.src.html — `.seg` segmented control.
export function Seg<T extends string>({ options, value, onChange, ...aria }: SegProps<T>) {
  return (
    <div className={styles.seg} role="tablist" {...aria}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? styles.on : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
