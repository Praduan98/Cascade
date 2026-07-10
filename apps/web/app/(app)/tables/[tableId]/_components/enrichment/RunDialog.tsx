'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Column, RunScope, RunScopeMode } from '@cascade/core'
import { Alert, Button, CostLine, Dialog, DialogClose, Switch, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import styles from './enrichment.module.css'

const nf = new Intl.NumberFormat('en-US')

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: Column[]
  selection: { recordIds: string[]; count: number }
  onStarted: (runId: string) => void
  /** Which engine to run against (default enrichment). */
  kind?: 'enrichment' | 'ai'
}

export function RunDialog({ open, onOpenChange, tableId, columns, selection, onStarted, kind = 'enrichment' }: Props) {
  const { toast } = useToast()
  const hasSelection = selection.count > 0
  const [mode, setMode] = useState<RunScopeMode>(hasSelection ? 'selected' : 'whole')
  const [forceFresh, setForceFresh] = useState(false)
  const svc = () => (kind === 'ai' ? getApi().ai : getApi().enrichment)

  const columnIds = useMemo(() => columns.map((c) => c.id), [columns])
  const scope: RunScope = useMemo(
    () => ({ mode, columnIds, recordIds: mode === 'selected' ? selection.recordIds : undefined }),
    [mode, columnIds, selection.recordIds],
  )

  const estimateQuery = useQuery({
    queryKey: [kind, 'estimate', tableId, mode, forceFresh, selection.recordIds.length, columnIds.length],
    queryFn: () => svc().estimate(tableId, scope, { forceFresh }),
    enabled: open,
  })
  const est = estimateQuery.data

  const runMutation = useMutation({
    mutationFn: () => svc().run(tableId, scope, { forceFresh }),
    onSuccess: ({ runId }) => {
      onStarted(runId)
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not start the run'), { variant: 'error' }),
  })

  const blocked = !!est && (est.blockedByPerRunCap || est.blockedByBudget)
  const canRun = !!est && est.rows >= 0 && !blocked && !runMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind === 'ai' ? 'Run AI columns' : 'Run enrichment'}
      description={
        kind === 'ai'
          ? 'AI columns run per row using the shared status machine. Cached and missing-input rows are free.'
          : 'Providers run in order and stop as soon as a value is accepted. Cached and empty-input rows are free.'
      }
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => runMutation.mutate()} disabled={!canRun}>
            {runMutation.isPending ? 'Starting…' : 'Confirm & run'}
          </Button>
        </>
      }
    >
      <div className={styles.scope}>
        <label className={[styles.scopeOpt, mode === 'selected' ? styles.on : '', !hasSelection ? styles.disabled : ''].filter(Boolean).join(' ')}>
          <input type="radio" name="scope" checked={mode === 'selected'} disabled={!hasSelection} onChange={() => setMode('selected')} />
          Selected rows{hasSelection ? ` (${selection.count})` : ' — none selected'}
        </label>
        <label className={[styles.scopeOpt, mode === 'whole' ? styles.on : ''].filter(Boolean).join(' ')}>
          <input type="radio" name="scope" checked={mode === 'whole'} onChange={() => setMode('whole')} />
          Whole table
        </label>
        <label className={[styles.scopeOpt, mode === 'empty-only' ? styles.on : ''].filter(Boolean).join(' ')}>
          <input type="radio" name="scope" checked={mode === 'empty-only'} onChange={() => setMode('empty-only')} />
          Only empty &amp; failed cells
        </label>
      </div>

      <div className={styles.toggles}>
        <div className={styles.switchRow}>
          <span className={styles.lbl}>Force fresh (bypass cache)</span>
          <Switch checked={forceFresh} onCheckedChange={setForceFresh} aria-label="Force fresh" />
        </div>
      </div>

      <CostLine amount={est ? `≤ ${nf.format(est.maxCredits)} credits` : '…'} />

      {est && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
          {nf.format(est.rows)} billable rows · {est.skippedCached + est.skippedEmptyInput + est.skippedAlreadyFilled} free (cached / empty-input / already filled)
        </p>
      )}

      {est?.blockedByPerRunCap && (
        <Alert variant="error" title="Over the per-run cap">
          This run could use up to {nf.format(est.maxCredits)} credits, above the per-run cap. Raise the cap in Usage &amp; credits, then retry.
        </Alert>
      )}
      {est?.blockedByBudget && !est.blockedByPerRunCap && (
        <Alert variant="error" title="Budget exhausted">
          The workspace budget is spent. Raise the budget in Usage &amp; credits to resume enrichment.
        </Alert>
      )}
    </Dialog>
  )
}
