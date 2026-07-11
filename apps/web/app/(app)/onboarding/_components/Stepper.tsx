'use client'
// Progress dots for the onboarding flow. `current` is the 1-based active step;
// steps before it render as "done" (check glyph), the rest as pending.

import { Fragment } from 'react'
import { CheckIcon } from '@cascade/ui'
import styles from '../onboarding.module.css'

export interface StepperProps {
  /** Short label per step, in order. */
  steps: string[]
  /** 1-based index of the active step. */
  current: number
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <div className={styles.stepper} role="list" aria-label="Onboarding progress">
      {steps.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        const cls = [styles.step, done ? styles.done : '', active ? styles.active : ''].filter(Boolean).join(' ')
        return (
          <Fragment key={label}>
            {i > 0 && <span className={[styles.connector, done || active ? styles.filled : ''].filter(Boolean).join(' ')} aria-hidden="true" />}
            <div
              className={cls}
              role="listitem"
              aria-current={active ? 'step' : undefined}
            >
              <span className={styles.dot}>{done ? <CheckIcon /> : n}</span>
              <span className={styles.stepLabel}>{label}</span>
              {done && <span className={styles.srOnly}> completed</span>}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
