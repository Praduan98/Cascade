'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { EnrichmentRun, IntegrationEventStatus } from '@cascade/core'
import { canManageIntegrations, canViewMargin, canWrite } from '@cascade/core'
import { Alert, Button, Card, CreditMeter, EmptyState, Pill } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate } from '../../lib/ui'
import { iconForTable } from '../_components/tableIcon'
import { CreateTableDialog } from '../_components/CreateTableDialog'
import styles from './home.module.css'

const nf = new Intl.NumberFormat('en-US')
const cf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd = (n: number) => cf.format(n)

type Kind = 'Enrich' | 'AI' | 'Agent' | 'HTTP'
type TaggedRun = EnrichmentRun & { kind: Kind }

function runPill(run: EnrichmentRun) {
  switch (run.status) {
    case 'complete':
      return <Pill status="success">done</Pill>
    case 'running':
      return <Pill status="running">running</Pill>
    case 'failed':
      return <Pill status="failed">failed</Pill>
    case 'paused':
      return <Pill status="empty">paused</Pill>
    default:
      return <Pill status="queued">queued</Pill>
  }
}

function eventPillStatus(s: IntegrationEventStatus) {
  if (s === 'success') return 'success' as const
  if (s === 'failed') return 'failed' as const
  if (s === 'partial') return 'empty' as const
  return 'queued' as const
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={styles.skelRow}>
          <div className={styles.skelBlock} style={{ width: 32, height: 32, borderRadius: 'var(--r-md)' }} />
          <div className={styles.skelLines}>
            <div className={styles.skelBlock} style={{ height: 12, width: '40%' }} />
            <div className={styles.skelBlock} style={{ height: 10, width: '60%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HomePage() {
  const { workspace, role, user } = useSession()
  const workspaceId = workspace?.id
  const canCost = role ? canViewMargin(role) : false
  const canIntegrations = role ? canManageIntegrations(role) : false
  const writable = role ? canWrite(role) : false
  const [createOpen, setCreateOpen] = useState(false)

  const balanceQuery = useQuery({
    queryKey: ['credits', 'balance', workspaceId],
    queryFn: () => getApi().credits.balance(workspaceId!),
    enabled: !!workspaceId,
  })
  const aiConsumptionQuery = useQuery({
    queryKey: ['credits', 'consumption', workspaceId, 'model-meter'],
    queryFn: () => getApi().credits.consumptionByModel(workspaceId!),
    enabled: !!workspaceId,
  })
  const billingQuery = useQuery({
    queryKey: ['billing', 'summary', workspaceId],
    queryFn: () => getApi().billing.summary(workspaceId!),
    enabled: !!workspaceId && canCost,
  })
  const tablesQuery = useQuery({
    queryKey: ['home', 'tables', workspaceId],
    queryFn: async () => {
      const api = getApi()
      const tables = await api.tables.list(workspaceId!)
      return Promise.all(tables.map(async (table) => ({ table, count: await api.records.count(table.id) })))
    },
    enabled: !!workspaceId,
  })
  const runsQuery = useQuery({
    queryKey: ['home', 'runs', workspaceId],
    queryFn: async () => {
      const api = getApi()
      const tag = (kind: Kind) => (rs: EnrichmentRun[]): TaggedRun[] => rs.map((r) => ({ ...r, kind }))
      const [en, ai, ag, ht] = await Promise.all([
        api.enrichment.runs.list(workspaceId!, { limit: 5 }).then(tag('Enrich')),
        api.ai.runs.list(workspaceId!, { limit: 5 }).then(tag('AI')),
        api.agent.runs.list(workspaceId!, { limit: 5 }).then(tag('Agent')),
        api.http.runs.list(workspaceId!, { limit: 5 }).then(tag('HTTP')),
      ])
      return [...en, ...ai, ...ag, ...ht]
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        .slice(0, 6)
    },
    enabled: !!workspaceId,
  })
  const eventsQuery = useQuery({
    queryKey: ['home', 'events', workspaceId],
    queryFn: () => getApi().integration.events(workspaceId!, { limit: 6 }),
    enabled: !!workspaceId && canIntegrations,
  })
  const onboardingQuery = useQuery({
    queryKey: ['onboarding', workspaceId],
    queryFn: () => getApi().onboarding.get(workspaceId!),
    enabled: !!workspaceId,
  })

  const balance = balanceQuery.data
  const used = balance ? Math.max(0, balance.budgetCap - balance.balance) : 0
  const aiUsed = (aiConsumptionQuery.data ?? []).reduce((s, b) => s + b.credits, 0)
  const segments = useMemo(() => {
    const aiSeg = Math.min(used, aiUsed)
    const segs = [{ label: 'Enrichment', value: Math.max(0, used - aiSeg), color: 'var(--brand)' }]
    if (aiSeg > 0) segs.push({ label: 'AI & agent', value: aiSeg, color: 'var(--cobalt)' })
    return segs
  }, [used, aiUsed])
  const tableName = useMemo(() => {
    const m = new Map<string, string>()
    ;(tablesQuery.data ?? []).forEach(({ table }) => m.set(table.id, table.name))
    return m
  }, [tablesQuery.data])

  const runs = runsQuery.data ?? []
  const tables = tablesQuery.data ?? []
  const events = eventsQuery.data ?? []
  const showNudge = writable && onboardingQuery.data?.status === 'pending'
  const firstName = user?.name?.split(' ')[0] ?? 'there'

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
          <h1>Welcome back, {firstName}</h1>
          <div className={styles.subtitle}>Here&rsquo;s what&rsquo;s happening in {workspace.name}</div>
        </div>
        {writable && (
          <div className={styles.actions}>
            <Link href="/templates" className="btn btn-secondary">
              Templates
            </Link>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New table
            </Button>
          </div>
        )}
      </header>

      {showNudge && (
        <Card className={[styles.card, styles.nudge].join(' ')}>
          <div className={styles.nudgeMain}>
            <b>Finish setting up</b>
            <div className={styles.subtitle}>Complete onboarding to get your first enriched table.</div>
          </div>
          <Link href="/onboarding" className="btn btn-primary btn-sm">
            Resume
          </Link>
        </Card>
      )}

      <div className={styles.grid}>
        <div className={styles.col}>
          {/* ---- Credits ---- */}
          <Card className={styles.card}>
            <div className={styles.sectionHead}>
              <h2>Credits</h2>
              <Link href="/usage" className={styles.viewAll}>
                Usage &rarr;
              </Link>
            </div>
            {balance?.paused && (
              <Alert variant="error" title="Budget exhausted">
                Billable runs are paused — raise the budget in Usage to resume.
              </Alert>
            )}
            {balanceQuery.isError ? (
              <Alert variant="error" title="Couldn’t load credits">
                {errorMessage(balanceQuery.error)}
              </Alert>
            ) : balance ? (
              <CreditMeter
                balance={balance.balance}
                used={used}
                total={balance.budgetCap}
                renewsLabel={billingQuery.data?.renewsAt ? `renews ${formatDate(billingQuery.data.renewsAt)}` : 'renews next period'}
                estCharge={canCost && billingQuery.data ? usd(billingQuery.data.nextChargeUsd) : undefined}
                segments={segments}
              />
            ) : (
              <div className={styles.skelBlock} style={{ height: 90, borderRadius: 'var(--r-lg)' }} />
            )}
          </Card>

          {/* ---- Recent runs ---- */}
          <Card className={styles.card}>
            <div className={styles.sectionHead}>
              <h2>Recent runs</h2>
              <Link href="/usage" className={styles.viewAll}>
                All runs &rarr;
              </Link>
            </div>
            {runsQuery.isLoading ? (
              <SkeletonRows n={4} />
            ) : runsQuery.isError ? (
              <Alert variant="error" title="Couldn’t load runs">
                {errorMessage(runsQuery.error)}
              </Alert>
            ) : runs.length === 0 ? (
              <EmptyState title="No runs yet" description="Run an enrichment or AI column and it’ll show up here." />
            ) : (
              <div className={styles.list}>
                {runs.map((run) => (
                  <div key={run.id} className={styles.row}>
                    <span className={styles.rowIcon}>{iconForTable(tableName.get(run.tableId) ?? '')}</span>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{tableName.get(run.tableId) ?? 'Table'}</div>
                      <div className={styles.rowMeta}>
                        <span>{run.kind}</span>
                        <span>·</span>
                        <span>
                          {nf.format(run.counts.processed)}/{nf.format(run.counts.total)}
                        </span>
                        {run.counts.failed > 0 && (
                          <>
                            <span>·</span>
                            <span>{run.counts.failed} failed</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.rowRight}>
                      {runPill(run)}
                      <span className={styles.num}>{nf.format(run.creditsConsumed)} cr</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className={styles.col}>
          {/* ---- Tables ---- */}
          <Card className={styles.card}>
            <div className={styles.sectionHead}>
              <h2>Tables</h2>
              <Link href="/tables" className={styles.viewAll}>
                All tables &rarr;
              </Link>
            </div>
            {tablesQuery.isLoading ? (
              <SkeletonRows n={3} />
            ) : tablesQuery.isError ? (
              <Alert variant="error" title="Couldn’t load tables">
                {errorMessage(tablesQuery.error)}
              </Alert>
            ) : tables.length === 0 ? (
              <EmptyState
                title="No tables yet"
                description={writable ? 'Create your first table to get started.' : 'No tables in this workspace yet.'}
                action={
                  writable ? (
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>
                      New table
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className={styles.list}>
                {tables.map(({ table, count }) => (
                  <Link key={table.id} href={`/tables/${table.id}`} className={styles.tableItem}>
                    <span className={styles.rowIcon}>{iconForTable(table.name)}</span>
                    <span className={styles.tableName}>{table.name}</span>
                    <span className={styles.tableCount}>{nf.format(count)} rows</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* ---- Activity (admin) ---- */}
          {canIntegrations && (
            <Card className={styles.card}>
              <div className={styles.sectionHead}>
                <h2>Activity</h2>
                <Link href="/integrations" className={styles.viewAll}>
                  Integrations &rarr;
                </Link>
              </div>
              {eventsQuery.isLoading ? (
                <SkeletonRows n={3} />
              ) : eventsQuery.isError ? (
                <Alert variant="error" title="Couldn’t load activity">
                  {errorMessage(eventsQuery.error)}
                </Alert>
              ) : events.length === 0 ? (
                <EmptyState title="No activity yet" description="CRM syncs, Slack alerts and sequencer pushes show up here." />
              ) : (
                <div className={styles.list}>
                  {events.map((ev) => (
                    <div key={ev.id} className={styles.row}>
                      <div className={styles.rowMain}>
                        <div className={styles.rowTitle}>{ev.summary}</div>
                        <div className={styles.rowMeta}>
                          <span>{ev.source}</span>
                          <span>·</span>
                          <span>{formatDate(ev.createdAt)}</span>
                        </div>
                      </div>
                      <Pill status={eventPillStatus(ev.status)}>{ev.status}</Pill>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {writable && workspaceId && (
        <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspaceId} />
      )}
    </div>
  )
}
