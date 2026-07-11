'use client'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Seg.module.css'

export interface SegOption<T extends string> {
  value: T
  label: ReactNode
}

/** `tabs` for view/section switching, `radio` for single-select form choices. */
export type SegVariant = 'tabs' | 'radio'

interface SegProps<T extends string> {
  options: SegOption<T>[]
  value: T
  onChange: (value: T) => void
  variant?: SegVariant
  'aria-label'?: string
}

// Ported from design-system.src.html — `.seg` segmented control.
// Implements the roving-tabindex keyboard model (only the active button is in the
// tab order; Arrow/Home/End move the selection and focus) for both the tablist and
// radiogroup roles.
export function Seg<T extends string>({ options, value, onChange, variant = 'tabs', ...aria }: SegProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const isRadio = variant === 'radio'
  const activeIdx = options.findIndex((o) => o.value === value)

  const focusAt = (i: number) => {
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus()
  }
  const selectAt = (i: number) => {
    const n = options.length
    if (n === 0) return
    const next = ((i % n) + n) % n
    const opt = options[next]
    if (!opt) return
    onChange(opt.value)
    focusAt(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = activeIdx < 0 ? 0 : activeIdx
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(from + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(from - 1)
        break
      case 'Home':
        e.preventDefault()
        selectAt(0)
        break
      case 'End':
        e.preventDefault()
        selectAt(options.length - 1)
        break
      default:
    }
  }

  return (
    <div
      ref={ref}
      className={styles.seg}
      role={isRadio ? 'radiogroup' : 'tablist'}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {options.map((o, i) => {
        const active = o.value === value
        // Roving tabindex: the active button is the single tab stop; if nothing is
        // selected yet, keep the first button reachable so the group isn't skipped.
        const tabbable = active || (activeIdx < 0 && i === 0)
        return (
          <button
            key={o.value}
            type="button"
            role={isRadio ? 'radio' : 'tab'}
            aria-selected={isRadio ? undefined : active}
            aria-checked={isRadio ? active : undefined}
            tabIndex={tabbable ? 0 : -1}
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
