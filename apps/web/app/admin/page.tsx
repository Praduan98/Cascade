'use client'
// Platform overview — the superadmin's business dashboard: MRR/ARR, active vs
// churned workspaces, conversion, and provider/LLM cost vs revenue margin
// (US-4.7), computed from subscriptions + invoices + the Phase 2 ledger.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { Seg } from '@cascade/ui'
import styles from './admin.module.css'

const nf = new Intl.NumberFormat('en-US')
const usd = (n: number) => `$${nf.format(Math.round(n))}`

type Range = 'all' | '30' | '90'
const RANGE_LABEL: Record<Range, string> = { all: 'All time', '30': '30 days', '90': '90 days' }
function sinceFor(range: Range): string | undefined {
  if (range === 'all') return undefined
  return new Date(Date.now() - Number(range) * 86400_000).toISOString()
}

const PLAN_COLOR: Record<string, string> = {
  plan_scale: 'var(--st-cached)',
  plan_growth: 'var(--brand)',
  plan_starter: 'var(--cobalt)',
  plan_free: 'var(--st-queued)',
}

export default function PlatformOverviewPage() {
  const [range, setRange] = useState<Range>('all')
  const analyticsQuery = useQuery({
    queryKey: ['platform', 'analytics', range],
    queryFn: () => getApi().platform.analytics({ since: sinceFor(range) }),
  })
  const a = analyticsQuery.data

  const maxMrr = useMemo(() => Math.max(1, ...(a?.mrrByPlan.map((p) => p.mrrUsd) ?? [1])), [a])
  const maxTrend = useMemo(() => Math.max(1, ...(a?.consumptionTrend.map((p) => p.credits) ?? [1])), [a])

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1>Overview</h1>
          <div className={styles.sub}>Platform health across all workspaces</div>
        </div>
        <Seg
          aria-label="Revenue &amp; cost window"
          value={range}
          onChange={setRange}
          options={(['all', '30', '90'] as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
        />
      </div>

      {!a ? (
        <div className={styles.skelBlock} style={{ height: 96, borderRadius: 12 }} />
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>MRR</span>
              <span className={[styles.kpiValue, styles.money].join(' ')}>{usd(a.mrrUsd)}</span>
              <span className={styles.kpiSub}>{usd(a.arrUsd)} ARR</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Gross margin</span>
              <span className={[styles.kpiValue, styles.money].join(' ')}>{usd(a.grossMarginUsd)}</span>
              <span className={styles.kpiSub}>{a.marginPct}% · {usd(a.cogsUsd)} COGS</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Workspaces</span>
              <span className={styles.kpiValue}>{a.activeWorkspaces}</span>
              <span className={styles.kpiSub}>{a.suspendedWorkspaces} suspended</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Conversion</span>
              <span className={styles.kpiValue}>{Math.round(a.conversion * 100)}%</span>
              <span className={styles.kpiSub}>{a.paidWorkspaces} paid · {a.freeWorkspaces} free</span>
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.card}>
              <div className={styles.sectionHead}>
                <h2>MRR by plan</h2>
                <span className={styles.sectionHint}>{usd(a.mrrUsd)} total</span>
              </div>
              <div className={styles.barRows}>
                {a.mrrByPlan.map((p) => (
                  <div key={p.planId} className={styles.barRow}>
                    <span className={styles.lab}>{p.planName}</span>
                    <span className={styles.barTrack}>
                      <i style={{ width: `${Math.round((p.mrrUsd / maxMrr) * 100)}%`, background: PLAN_COLOR[p.planId] ?? 'var(--brand)' }} />
                    </span>
                    <span className={styles.val}>{usd(p.mrrUsd)}</span>
                  </div>
                ))}
                {a.mrrByPlan.length === 0 && <span className={styles.sectionHint}>No paid subscriptions yet.</span>}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.sectionHead}>
                <h2>Credit consumption</h2>
                <span className={styles.sectionHint}>all workspaces</span>
              </div>
              <div className={styles.spark}>
                {a.consumptionTrend.map((t) => (
                  <div key={t.label} className={styles.sparkCol}>
                    <div className={styles.sparkBar} style={{ height: `${Math.max(4, Math.round((t.credits / maxTrend) * 96))}px` }} title={`${nf.format(t.credits)} credits`} />
                    <span className={styles.sparkLabel}>{t.label.slice(5)}</span>
                  </div>
                ))}
                {a.consumptionTrend.length === 0 && <span className={styles.sectionHint}>No consumption yet.</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
