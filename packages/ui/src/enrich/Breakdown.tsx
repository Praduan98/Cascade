import type { ReactNode } from 'react'
import styles from './credits.module.css'

export interface BreakdownRowProps {
  label: ReactNode
  /** Pre-formatted credits, e.g. "11,400 cr". */
  credits: string
  /** Pre-formatted money, e.g. "$91.20" — Admin only; omit to collapse the column. */
  cost?: string
  /** 0..1 — track fill. */
  fraction: number
}

export function BreakdownRow({ label, credits, cost, fraction }: BreakdownRowProps) {
  return (
    <div className={[styles.bdRow, cost === undefined ? styles.noMoney : ''].filter(Boolean).join(' ')}>
      <span>{label}</span>
      <span className={styles.credits}>{credits}</span>
      {cost !== undefined ? <span className={styles.cost}>{cost}</span> : null}
      <span className={styles.track}>
        <i style={{ width: `${Math.max(0, Math.min(100, fraction * 100))}%` }} />
      </span>
    </div>
  )
}

export function Breakdown({ children }: { children: ReactNode }) {
  return <div className={styles.breakdown}>{children}</div>
}
