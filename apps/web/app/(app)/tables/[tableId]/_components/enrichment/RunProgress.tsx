'use client'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { EnrichmentRunStatus } from '@cascade/core'
import { Pill } from '@cascade/ui'
import styles from './enrichment.module.css'

const ACTIVE: EnrichmentRunStatus[] = ['queued', 'running']

// The inline run-progress strip between the toolbar and the grid. Polls the run
// while it's active; cells animate their status in the grid independently.
export function RunProgress({ runId, onDone, kind = 'enrichment' }: { runId: string; onDone: () => void; kind?: 'enrichment' | 'ai' }) {
  const runQuery = useQuery({
    queryKey: [kind, 'run', runId],
    queryFn: () => (kind === 'ai' ? getApi().ai : getApi().enrichment).runs.get(runId),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 500 : false),
  })
  const run = runQuery.data
  if (!run) return null

  const { processed, total, success, empty, failed, cached } = run.counts
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const done = !ACTIVE.includes(run.status)
  const verb = kind === 'ai' ? 'Generating' : 'Enriching'

  return (
    <div className={styles.progress} role="status" aria-live="polite">
      <span className={styles.progressText}>
        {done
          ? run.status === 'paused'
            ? 'Run paused — budget reached'
            : `Run complete · ${processed} processed`
          : `${verb} ${processed} / ${total}`}
      </span>
      <span className={styles.bar}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.progressCounts}>
        {success > 0 && <Pill status="success">{success}</Pill>}
        {cached > 0 && <Pill status="cached">{cached}</Pill>}
        {empty > 0 && <Pill status="empty">{empty}</Pill>}
        {failed > 0 && <Pill status="failed">{failed}</Pill>}
      </span>
      {done && (
        <button type="button" className={styles.dismiss} onClick={onDone} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
