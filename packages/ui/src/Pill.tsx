import type { ReactNode } from 'react'

export type PillStatus = 'queued' | 'running' | 'success' | 'empty' | 'failed' | 'cached'

// The enrichment status pill from the design system. Only `running` animates
// (the breathing dot). Uses the global .pill / .pill-* classes from the tokens.
export function Pill({ status, children }: { status: PillStatus; children: ReactNode }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" />
      {children}
    </span>
  )
}
