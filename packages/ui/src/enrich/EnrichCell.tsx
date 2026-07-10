import { Pill } from '../Pill'
import styles from './enrichcell.module.css'

export type EnrichStatus = 'queued' | 'running' | 'success' | 'empty' | 'failed' | 'cached'

const PILL_LABEL: Record<EnrichStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  empty: 'Empty',
  failed: 'Failed',
  cached: 'Cached',
}

export function MiniDot({ status }: { status: EnrichStatus }) {
  return <span className={styles.miniDot} style={{ background: `var(--st-${status})` }} aria-hidden="true" />
}

export interface EnrichCellProps {
  status: EnrichStatus
  /** Value (success/cached) or muted text ("no match found", "queued", …). */
  display?: string
  /** Render as muted placeholder rather than a value. */
  muted?: boolean
  /** Render an inline status Pill (true for all states except success, per the design). */
  pill?: boolean
  /** Override the pill label (e.g. "Deliverable"). */
  pillLabel?: string
  /** Failed hover text, e.g. "Provider timeout after 3 retries". */
  title?: string
}

// The DOM rendering of an enrichment cell — used for provenance previews, the
// inspector, the gallery, and as an accessible fallback for the canvas grid.
export function EnrichCell({ status, display, muted, pill, pillLabel, title }: EnrichCellProps) {
  return (
    <div className={styles.cell}>
      <div className={styles.enrichCell} title={title}>
        {status === 'running' ? (
          <>
            <span className={styles.shimmer} />
            <Pill status="running">Running</Pill>
          </>
        ) : (
          <>
            <MiniDot status={status} />
            <span className={muted ? styles.muted : styles.val}>{display}</span>
            {pill ? <Pill status={status}>{pillLabel ?? PILL_LABEL[status]}</Pill> : null}
          </>
        )}
      </div>
      {status === 'running' ? <span className={styles.runningBar} /> : null}
    </div>
  )
}
