'use client'
// Billing & plans (Phase 4) — the workspace owner's commercial surface: current
// plan + usage meter, plan comparison/change, credit-pack top-ups, invoices, and
// cancel. Owner-gated (canManageSubscription); every $ figure is gold and, for
// margin, canViewMargin-gated. Consumption reconciles to the Phase 2 ledger.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CREDIT_PACKS, getApi } from '@cascade/data'
import { canManageSubscription, PLAN_RANK } from '@cascade/core'
import type { Plan } from '@cascade/core'
import { Alert, Button, Card, CostLine, CreditMeter, Dialog, DialogClose, EmptyState, Pill, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate } from '../../lib/ui'
import styles from './billing.module.css'

const nf = new Intl.NumberFormat('en-US')
const usd = (n: number) => `$${nf.format(Math.round(n * 100) / 100)}`

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

const INVOICE_STATUS: Record<string, 'success' | 'empty' | 'failed' | 'cached'> = {
  paid: 'success',
  open: 'empty',
  void: 'cached',
  refunded: 'failed',
}

export default function BillingPage() {
  const { workspace, role } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()
  const workspaceId = workspace?.id
  const canManage = role ? canManageSubscription(role) : false

  const [planTarget, setPlanTarget] = useState<Plan | null>(null)
  const [packTarget, setPackTarget] = useState<(typeof CREDIT_PACKS)[number] | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  const summaryQuery = useQuery({
    queryKey: ['billing', 'summary', workspaceId],
    queryFn: () => getApi().billing.summary(workspaceId!),
    enabled: !!workspaceId && canManage,
  })
  const plansQuery = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => getApi().billing.plans.list(),
    enabled: canManage,
  })
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices', workspaceId],
    queryFn: () => getApi().billing.invoices(workspaceId!),
    enabled: !!workspaceId && canManage,
  })

  const summary = summaryQuery.data
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data])
  const invoices = invoicesQuery.data ?? []

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['billing'] })
    void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspaceId] })
    void qc.invalidateQueries({ queryKey: ['members', workspaceId] })
  }

  const changePlan = useMutation({
    mutationFn: (planId: string) => getApi().billing.changePlan(workspaceId!, planId),
    onSuccess: (_r, planId) => {
      const p = plans.find((x) => x.id === planId)
      toast(`Switched to ${p?.name ?? 'the new plan'}`, { variant: 'success' })
      setPlanTarget(null)
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not change the plan'), { variant: 'error' }),
  })
  const buyCredits = useMutation({
    mutationFn: (pack: (typeof CREDIT_PACKS)[number]) => getApi().billing.purchaseCredits(workspaceId!, { credits: pack.credits, amountUsd: pack.amountUsd }),
    onSuccess: (_r, pack) => {
      toast(`Added ${nf.format(pack.credits)} credits`, { variant: 'success' })
      setPackTarget(null)
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not buy credits'), { variant: 'error' }),
  })
  const setCancel = useMutation({
    mutationFn: (cancel: boolean) => getApi().billing.setCancel(workspaceId!, cancel),
    onSuccess: (_r, cancel) => {
      toast(cancel ? 'Subscription will cancel at period end' : 'Cancellation reversed', { variant: cancel ? 'warn' : 'success' })
      setCancelOpen(false)
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not update the subscription'), { variant: 'error' }),
  })

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">You&rsquo;re not a member of any workspace yet.</Alert>
      </div>
    )
  }
  if (!canManage) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<LockGlyph />}
          title="Billing is restricted"
          description="Only the workspace owner can manage the plan, credits, and invoices."
          action={<Link href="/tables" className="btn btn-secondary">Back to tables</Link>}
        />
      </div>
    )
  }

  const seatPct = summary && summary.seats.limit > 0 ? Math.min(1, summary.seats.used / summary.seats.limit) : 0
  const seatsFull = !!summary && summary.seats.used >= summary.seats.limit
  // US-4.4 — a downgrade whose seat limit is below current usage is blocked.
  const overSeatDowngrade = !!(planTarget && summary && planTarget.seatLimit < summary.seats.used)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Billing &amp; plans</h1>
          <div className={styles.count}>{summary?.plan ? `${summary.plan.name} plan · ${workspace.name}` : 'Loading…'}</div>
        </div>
      </header>

      {(summaryQuery.isError || plansQuery.isError || invoicesQuery.isError) && (
        <Alert variant="error" title="Couldn’t load billing" className={styles.state}>
          {errorMessage(summaryQuery.error ?? plansQuery.error ?? invoicesQuery.error)}
        </Alert>
      )}

      {summary?.cancelAtPeriodEnd && (
        <Alert variant="warn" title="Subscription ending" className={styles.state}>
          Your plan cancels on {summary.renewsAt ? formatDate(summary.renewsAt) : 'the period end'}. You&rsquo;ll drop to the Free tier after that.
        </Alert>
      )}

      {/* ---- Plan & usage ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Plan &amp; usage</h2>
          <span className={styles.sectionHint}>this billing period</span>
        </div>
        {summary ? (
          <div className={styles.summaryGrid}>
            <div>
              <div className={styles.planLine}>
                <span className={styles.planNow}>{summary.plan?.name ?? 'Free'}</span>
                <span className={styles.planPriceNow}>{summary.plan ? `${usd(summary.plan.priceUsdMonthly)}/mo` : '$0/mo'}</span>
              </div>
              <div className={styles.renews}>
                {summary.cancelAtPeriodEnd
                  ? `cancels ${summary.renewsAt ? formatDate(summary.renewsAt) : ''}`
                  : `renews ${summary.renewsAt ? formatDate(summary.renewsAt) : ''} · next charge ${usd(summary.nextChargeUsd)}`}
              </div>
              <div className={styles.seatRow}>
                <div className={styles.seatTop}>
                  <span>Seats</span>
                  <span>{summary.seats.used} / {summary.seats.limit}</span>
                </div>
                <span className={styles.seatBar}><i className={seatsFull ? 'full' : ''} style={{ width: `${Math.round(seatPct * 100)}%` }} /></span>
                {seatsFull && <span className={styles.sectionHint}>Seat limit reached — upgrade to invite more.</span>}
              </div>
            </div>
            <CreditMeter
              balance={summary.balance}
              used={summary.usedThisPeriod}
              total={summary.includedCredits}
              renewsLabel={summary.overageCredits > 0 ? `${nf.format(summary.overageCredits)} over included` : 'included this period'}
              estCharge={usd(summary.nextChargeUsd)}
              segments={[{ label: 'Used this period', value: summary.usedThisPeriod, color: 'var(--brand)' }]}
            />
          </div>
        ) : (
          <div className={styles.skelBlock} style={{ height: 96, borderRadius: 12 }} />
        )}
      </Card>

      {/* ---- Plans ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Change plan</h2>
          <span className={styles.sectionHint}>upgrade or downgrade anytime</span>
        </div>
        <div className={styles.planGrid}>
          {plans.map((plan) => {
            const current = summary?.plan?.id === plan.id
            const rankNow = summary?.plan ? PLAN_RANK[summary.plan.tier] : 0
            const dir = PLAN_RANK[plan.tier] > rankNow ? 'Upgrade' : 'Switch'
            return (
              <div key={plan.id} className={[styles.planCard, current ? styles.current : ''].filter(Boolean).join(' ')}>
                <div className={styles.planHd}>
                  <span className={styles.planName}>{plan.name}</span>
                  {current && <Pill status="running">Current</Pill>}
                </div>
                <div className={styles.planPrice}>{usd(plan.priceUsdMonthly)}<small> /mo</small></div>
                <p className={styles.planBlurb}>{plan.blurb}</p>
                <ul className={styles.planFeatures}>
                  {plan.features.map((f) => (
                    <li key={f}><Check /> {f}</li>
                  ))}
                </ul>
                <Button variant={current ? 'ghost' : 'secondary'} size="sm" disabled={current} onClick={() => setPlanTarget(plan)}>
                  {current ? 'Current plan' : `${dir} to ${plan.name}`}
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      {/* ---- Credit packs ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Buy credits</h2>
          <span className={styles.sectionHint}>added to your balance immediately</span>
        </div>
        <div className={styles.packGrid}>
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className={styles.packCard}>
              <span className={styles.packCredits}>{nf.format(pack.credits)} credits</span>
              <span className={styles.packPrice}>{usd(pack.amountUsd)}</span>
              <span className={styles.packRate}>${(pack.amountUsd / pack.credits * 1000).toFixed(2)} / 1k credits</span>
              <Button variant="secondary" size="sm" onClick={() => setPackTarget(pack)}>Buy pack</Button>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- Invoices ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Invoices</h2>
          {invoices.length > 0 && <span className={styles.sectionHint}>{invoices.length} invoices</span>}
        </div>
        {invoicesQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 80, borderRadius: 8 }} />
        ) : invoices.length === 0 ? (
          <EmptyState title="No invoices yet" description="Invoices for your subscription and top-ups appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr><th>Date</th><th>Description</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className={styles.when}>{formatDate(inv.createdAt)}</td>
                    <td>{inv.lines[0]?.label ?? '—'}</td>
                    <td><Pill status={INVOICE_STATUS[inv.status] ?? 'empty'}>{inv.status}</Pill></td>
                    <td className={styles.money}>{usd(inv.amountUsd)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast('Invoice PDF is a mock in this build', { variant: 'default' })}>Download</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- Cancel ---- */}
      {summary?.plan && summary.plan.priceUsdMonthly > 0 && (
        <Card className={styles.card}>
          <div className={styles.dangerRow}>
            <div>
              <div className={styles.sectionHead} style={{ marginBottom: 4 }}><h2>Cancel subscription</h2></div>
              <p className={styles.dangerText}>
                {summary.cancelAtPeriodEnd
                  ? 'Your subscription is set to cancel at the period end.'
                  : 'Keep access until the end of the paid period, then drop to Free.'}
              </p>
            </div>
            {summary.cancelAtPeriodEnd ? (
              <Button variant="secondary" onClick={() => setCancel.mutate(false)} disabled={setCancel.isPending}>Keep my plan</Button>
            ) : (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel plan</Button>
            )}
          </div>
        </Card>
      )}

      {/* ---- Confirm dialogs ---- */}
      <Dialog
        open={planTarget != null}
        onOpenChange={(o) => { if (!o) setPlanTarget(null) }}
        title={planTarget ? `Switch to ${planTarget.name}?` : ''}
        description={planTarget ? planTarget.blurb : undefined}
        footer={
          <>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button variant="primary" disabled={changePlan.isPending || overSeatDowngrade} onClick={() => planTarget && changePlan.mutate(planTarget.id)}>
              {changePlan.isPending ? 'Switching…' : 'Confirm & switch'}
            </Button>
          </>
        }
      >
        {planTarget && (
          <>
            <CostLine label="New monthly price" amount={`${usd(planTarget.priceUsdMonthly)} / month`} />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
              {nf.format(planTarget.includedCredits)} credits included · {planTarget.seatLimit} seats
              {summary?.plan && PLAN_RANK[planTarget.tier] > PLAN_RANK[summary.plan.tier] ? ' · upgrade credits added now' : ''}
            </p>
            {overSeatDowngrade && (
              <Alert variant="warn" title="Over the new seat limit">
                {planTarget.name} allows {planTarget.seatLimit} seats but this workspace uses {summary!.seats.used}. Remove members before downgrading.
              </Alert>
            )}
          </>
        )}
      </Dialog>

      <Dialog
        open={packTarget != null}
        onOpenChange={(o) => { if (!o) setPackTarget(null) }}
        title="Buy credit pack"
        description="A one-time top-up billed to your card. Credits are added instantly."
        footer={
          <>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button variant="primary" disabled={buyCredits.isPending} onClick={() => packTarget && buyCredits.mutate(packTarget)}>
              {buyCredits.isPending ? 'Purchasing…' : 'Confirm & pay'}
            </Button>
          </>
        }
      >
        {packTarget && <CostLine label={`${nf.format(packTarget.credits)} credits`} amount={usd(packTarget.amountUsd)} />}
      </Dialog>

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel subscription?"
        description="You'll keep full access until the end of the current paid period, then move to the Free tier."
        footer={
          <>
            <DialogClose asChild><Button variant="ghost">Keep plan</Button></DialogClose>
            <Button variant="danger" disabled={setCancel.isPending} onClick={() => setCancel.mutate(true)}>
              {setCancel.isPending ? 'Cancelling…' : 'Cancel at period end'}
            </Button>
          </>
        }
      />
    </div>
  )
}
