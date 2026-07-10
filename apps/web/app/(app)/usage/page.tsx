'use client'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { EnrichmentRun } from '@cascade/core'
import { canManageBilling, canViewMargin } from '@cascade/core'
import {
  Alert,
  Avatar,
  Breakdown,
  BreakdownRow,
  Button,
  Card,
  CreditMeter,
  Dialog,
  DialogClose,
  EmptyState,
  Field,
  Input,
  Pill,
  Seg,
  useToast,
} from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate, initials } from '../../lib/ui'
import styles from './usage.module.css'

type Dim = 'provider' | 'column' | 'table' | 'model'
const nf = new Intl.NumberFormat('en-US')
const AVATAR_COLORS = ['#2fe6c8', '#4f9dff', '#38d08c', '#ab8cfb', '#f2666b', '#16b79e', '#f5b544']
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] as string
}

function scopeLabel(run: EnrichmentRun): string {
  const cols = run.scope.columnIds.length
  const colPart = `${cols} column${cols === 1 ? '' : 's'}`
  if (run.scope.mode === 'whole') return `whole table · ${colPart}`
  if (run.scope.mode === 'empty-only') return `empty cells · ${colPart}`
  return `${run.scope.recordIds?.length ?? run.counts.total} rows · ${colPart}`
}

export default function UsagePage() {
  const { workspace, role } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()
  const workspaceId = workspace?.id
  const canBudget = role ? canManageBilling(role) : false
  const canCost = role ? canViewMargin(role) : false

  const [dim, setDim] = useState<Dim>('provider')
  const [budgetOpen, setBudgetOpen] = useState(false)

  const balanceQuery = useQuery({
    queryKey: ['credits', 'balance', workspaceId],
    queryFn: () => getApi().credits.balance(workspaceId!),
    enabled: !!workspaceId,
  })
  const consumptionQuery = useQuery({
    queryKey: ['credits', 'consumption', workspaceId, dim],
    queryFn: () => {
      const api = getApi().credits
      if (dim === 'column') return api.consumptionByColumn(workspaceId!)
      if (dim === 'table') return api.consumptionByTable(workspaceId!)
      if (dim === 'model') return api.consumptionByModel(workspaceId!)
      return api.consumptionByProvider(workspaceId!)
    },
    enabled: !!workspaceId,
  })
  // AI spend total, for the cobalt "AI & agent" meter segment.
  const aiConsumptionQuery = useQuery({
    queryKey: ['credits', 'consumption', workspaceId, 'model-meter'],
    queryFn: () => getApi().credits.consumptionByModel(workspaceId!),
    enabled: !!workspaceId,
  })
  const runsQuery = useQuery({
    queryKey: ['enrichment', 'runs', workspaceId],
    queryFn: () => getApi().enrichment.runs.list(workspaceId!, { limit: 50 }),
    enabled: !!workspaceId,
  })
  const aiRunsQuery = useQuery({
    queryKey: ['ai', 'runs', workspaceId],
    queryFn: () => getApi().ai.runs.list(workspaceId!, { limit: 50 }),
    enabled: !!workspaceId,
  })

  const balance = balanceQuery.data
  const consumption = consumptionQuery.data ?? []
  const runs = useMemo(
    () =>
      [...(runsQuery.data ?? []), ...(aiRunsQuery.data ?? [])].sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
      ),
    [runsQuery.data, aiRunsQuery.data],
  )

  const used = balance ? Math.max(0, balance.budgetCap - balance.balance) : 0
  const pct = balance && balance.budgetCap > 0 ? used / balance.budgetCap : 0
  const totalUsd = consumption.reduce((s, b) => s + (b.providerCostUsd ?? 0), 0)
  const maxCredits = Math.max(1, ...consumption.map((b) => b.credits))
  const aiUsed = (aiConsumptionQuery.data ?? []).reduce((s, b) => s + b.credits, 0)

  const segments = useMemo(() => {
    const aiSeg = Math.min(used, aiUsed)
    const segs = [{ label: 'Enrichment', value: Math.max(0, used - aiSeg), color: 'var(--brand)' }]
    if (aiSeg > 0) segs.push({ label: 'AI & agent', value: aiSeg, color: 'var(--cobalt)' })
    return segs
  }, [used, aiUsed])

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Usage &amp; credits</h1>
          <div className={styles.count}>
            {balance ? `${nf.format(balance.balance)} credits remaining in ${workspace.name}` : 'Loading…'}
          </div>
        </div>
        {canBudget && (
          <Button variant="primary" onClick={() => setBudgetOpen(true)}>
            Set budget cap
          </Button>
        )}
      </header>

      {balance?.paused && (
        <Alert variant="error" title="Budget exhausted" className={styles.state}>
          The workspace budget is spent — billable enrichment is paused. Raise the budget to resume runs.
        </Alert>
      )}
      {balance && !balance.paused && pct >= 0.85 && (
        <Alert variant="warn" title="Approaching budget" className={styles.state}>
          {Math.round(pct * 100)}% of the workspace budget is consumed this period.
        </Alert>
      )}
      {balanceQuery.isError && (
        <Alert variant="error" title="Couldn’t load usage" className={styles.state}>
          {errorMessage(balanceQuery.error)}
        </Alert>
      )}

      {/* ---- Credit meter ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Workspace credit meter</h2>
          <span className={styles.sectionHint}>this billing period</span>
        </div>
        {balance ? (
          <CreditMeter
            balance={balance.balance}
            used={used}
            total={balance.budgetCap}
            renewsLabel="renews next period"
            estCharge={canCost ? `$${totalUsd.toFixed(0)}` : undefined}
            segments={segments}
          />
        ) : (
          <div className={styles.skelBlock} style={{ height: 90, borderRadius: 12 }} />
        )}
      </Card>

      {/* ---- Consumption breakdown ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Consumption</h2>
          <Seg
            aria-label="Break down consumption by"
            value={dim}
            onChange={setDim}
            options={[
              { value: 'provider', label: 'By provider' },
              { value: 'model', label: 'By model' },
              { value: 'column', label: 'By column' },
              { value: 'table', label: 'By table' },
            ]}
          />
        </div>
        {consumptionQuery.isLoading ? (
          <div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.skelBlock} style={{ height: 28, margin: '8px 0', borderRadius: 6 }} />
            ))}
          </div>
        ) : consumption.length === 0 ? (
          <EmptyState title="No spend yet" description="Run an enrichment or AI column to see consumption here." />
        ) : (
          <Breakdown>
            {consumption.map((b) => (
              <BreakdownRow
                key={b.key}
                label={b.label}
                credits={`${nf.format(b.credits)} cr`}
                cost={canCost && b.providerCostUsd != null ? `$${b.providerCostUsd.toFixed(2)}` : undefined}
                fraction={b.credits / maxCredits}
              />
            ))}
          </Breakdown>
        )}
      </Card>

      {/* ---- Run history ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Run history</h2>
          {runs.length > 0 && <span className={styles.sectionHint}>{runs.length} runs</span>}
        </div>
        {runsQuery.isLoading || aiRunsQuery.isLoading ? (
          <div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.skelRow}>
                <div className={styles.skelLines}>
                  <div className={styles.skelBlock} style={{ height: 12, width: '30%' }} />
                  <div className={styles.skelBlock} style={{ height: 10, width: '50%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" description="Run an enrichment or AI column and its history will appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>When</th>
                  <th>Scope</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: 'right' }}>Credits</th>
                  {canCost && <th style={{ textAlign: 'right' }}>Provider cost</th>}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const bg = avatarColor(run.triggeredBy || run.triggeredByName)
                  return (
                    <tr key={run.id}>
                      <td>
                        <span className={styles.who}>
                          <Avatar initials={initials(run.triggeredByName)} bg={bg} size={24} />
                          <span className={styles.whoName}>{run.triggeredByName}</span>
                        </span>
                      </td>
                      <td className={styles.when}>{formatDate(run.startedAt)}</td>
                      <td className={styles.scope}>{scopeLabel(run)}</td>
                      <td>
                        <span className={styles.counts}>
                          {run.counts.success > 0 && <Pill status="success">{run.counts.success}</Pill>}
                          {run.counts.cached > 0 && <Pill status="cached">{run.counts.cached}</Pill>}
                          {run.counts.empty > 0 && <Pill status="empty">{run.counts.empty}</Pill>}
                          {run.counts.failed > 0 && <Pill status="failed">{run.counts.failed}</Pill>}
                          {run.status === 'paused' && <Pill status="queued">paused</Pill>}
                        </span>
                      </td>
                      <td className={styles.num}>{nf.format(run.creditsConsumed)}</td>
                      {canCost && <td className={styles.money}>${run.providerCostUsd.toFixed(2)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canBudget && workspaceId && (
        <SetBudgetDialog
          open={budgetOpen}
          onOpenChange={setBudgetOpen}
          workspaceId={workspaceId}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspaceId] })
            toast('Budget updated', { variant: 'success' })
          }}
        />
      )}
    </div>
  )
}

function SetBudgetDialog({
  open,
  onOpenChange,
  workspaceId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  workspaceId: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [budgetCap, setBudgetCap] = useState('')
  const [perRunCap, setPerRunCap] = useState('')

  const budgetQuery = useQuery({
    queryKey: ['credits', 'budget', workspaceId],
    queryFn: () => getApi().credits.budget.get(workspaceId),
    enabled: open,
  })

  // Seed the inputs when the current budget loads.
  useEffect(() => {
    if (budgetQuery.data) {
      setBudgetCap(String(budgetQuery.data.budgetCap))
      setPerRunCap(String(budgetQuery.data.perRunCap))
    }
  }, [budgetQuery.data])

  const mutation = useMutation({
    mutationFn: () =>
      getApi().credits.budget.set(workspaceId, { budgetCap: Number(budgetCap), perRunCap: Number(perRunCap) }),
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not update the budget'), { variant: 'error' }),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Set budget cap"
      description="Cap total workspace spend and the maximum a single run can consume."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save budget'}
          </Button>
        </>
      }
    >
      <Field label="Workspace budget (credits)" htmlFor="budget-cap" hint="Total credits available this period.">
        <Input id="budget-cap" type="number" min={0} value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} />
      </Field>
      <Field label="Per-run maximum (credits)" htmlFor="run-cap" hint="A run whose estimate exceeds this is blocked before it starts.">
        <Input id="run-cap" type="number" min={0} value={perRunCap} onChange={(e) => setPerRunCap(e.target.value)} />
      </Field>
    </Dialog>
  )
}
