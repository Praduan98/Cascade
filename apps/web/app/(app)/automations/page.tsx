'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type {
  Automation,
  AutomationRunStatus,
  Column,
  InboundWebhook,
  IntegrationEvent,
  IntegrationEventSource,
  IntegrationEventStatus,
  OutboundWebhook,
  TableMeta,
} from '@cascade/core'
import { canManageAutomations } from '@cascade/core'
import { Alert, Button, Card, EmptyState, Pill, Seg, Switch, Tag, useToast } from '@cascade/ui'
import type { PillStatus } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate } from '../../lib/ui'
import { AutomationDialog } from './_components/AutomationDialog'
import { InboundWebhookDialog } from './_components/InboundWebhookDialog'
import { OutboundWebhookDialog } from './_components/OutboundWebhookDialog'
import styles from './automations.module.css'

const nf = new Intl.NumberFormat('en-US')
type Tab = 'automations' | 'webhooks' | 'activity'
type ColumnsByTable = Record<string, Column[]>

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SOURCE_LABEL: Record<IntegrationEventSource, string> = {
  schedule: 'Schedule',
  row_event: 'Row event',
  webhook_in: 'Inbound webhook',
  webhook_out: 'Outbound webhook',
  crm: 'CRM',
  slack: 'Slack',
}

/** The 4-state run/event status maps onto the design-system status pills. */
function statusPill(s: AutomationRunStatus | IntegrationEventStatus): PillStatus {
  if (s === 'success') return 'success'
  if (s === 'failed') return 'failed'
  if (s === 'partial') return 'cached'
  return 'empty' // skipped
}

function outboundPill(s: OutboundWebhook['lastStatus']): PillStatus {
  if (s === 'delivered') return 'success'
  if (s === 'failed') return 'failed'
  return 'queued' // retrying
}

function triggerLabel(a: Automation): string {
  if (a.trigger === 'schedule' && a.schedule) {
    const { cadence, hour, weekday } = a.schedule
    if (cadence === 'hourly') return 'Hourly'
    const hh = `${String(hour ?? 0).padStart(2, '0')}:00`
    if (cadence === 'weekly') return `Weekly · ${WEEKDAY[weekday ?? 0] ?? 'Sun'} ${hh}`
    return `Daily · ${hh}`
  }
  if (a.trigger === 'row_event' && a.rowEvent) {
    return a.rowEvent.event === 'record.created' ? 'On row created' : 'On row updated'
  }
  return a.trigger
}

function colName(columnsByTable: ColumnsByTable, tableId: string, columnId?: string): string {
  if (!columnId) return '—'
  return (columnsByTable[tableId] ?? []).find((c) => c.id === columnId)?.name ?? 'column'
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.skelRow}>
          <div className={styles.skelLines}>
            <div className={styles.skelBlock} style={{ height: 12, width: '32%' }} />
            <div className={styles.skelBlock} style={{ height: 10, width: '54%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function LockGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default function AutomationsPage() {
  const { workspace, role } = useSession()
  const workspaceId = workspace?.id
  const authorized = role ? canManageAutomations(role) : false
  const [tab, setTab] = useState<Tab>('automations')

  const tablesQuery = useQuery({
    queryKey: ['tables', 'list', workspaceId],
    queryFn: () => getApi().tables.list(workspaceId!),
    enabled: !!workspaceId && authorized,
  })
  const tables = tablesQuery.data ?? []
  const tableIds = tables.map((t) => t.id)

  const columnsQuery = useQuery({
    queryKey: ['automations', 'columns-map', workspaceId, tableIds.join(',')],
    queryFn: async () => {
      const api = getApi()
      const pairs = await Promise.all(tableIds.map(async (id) => [id, await api.columns.list(id)] as const))
      return Object.fromEntries(pairs) as ColumnsByTable
    },
    enabled: !!workspaceId && authorized && tableIds.length > 0,
  })
  const columnsByTable = columnsQuery.data ?? {}

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<LockGlyph />}
          title="Automations are restricted"
          description="Only owners and admins can create schedules, row-event triggers, and webhooks."
          action={
            <Link href="/tables">
              <Button variant="secondary">Back to tables</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Automations</h1>
          <div className={styles.count}>Schedules, row-event triggers, and webhooks for {workspace.name}</div>
        </div>
      </header>

      <div className={styles.tabs}>
        <Seg
          aria-label="Automations section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'automations', label: 'Automations' },
            { value: 'webhooks', label: 'Webhooks' },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </div>

      {tab === 'automations' && (
        <AutomationsSection workspaceId={workspace.id} tables={tables} columnsByTable={columnsByTable} tablesLoading={tablesQuery.isLoading} />
      )}
      {tab === 'webhooks' && (
        <WebhooksSection workspaceId={workspace.id} tables={tables} columnsByTable={columnsByTable} tablesLoading={tablesQuery.isLoading} />
      )}
      {tab === 'activity' && <ActivitySection workspaceId={workspace.id} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

function AutomationsSection({
  workspaceId,
  tables,
  columnsByTable,
  tablesLoading,
}: {
  workspaceId: string
  tables: TableMeta[]
  columnsByTable: ColumnsByTable
  tablesLoading: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const key = ['automations', 'list', workspaceId]

  const query = useQuery({
    queryKey: key,
    queryFn: () => getApi().automation.automations.list(workspaceId),
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: key })

  const setEnabled = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => getApi().automation.automations.setEnabled(workspaceId, v.id, v.enabled),
    onSuccess: invalidate,
    onError: (err) => toast(errorMessage(err, 'Could not update the automation'), { variant: 'error' }),
  })
  const runNow = useMutation({
    mutationFn: (id: string) => getApi().automation.automations.runNow(workspaceId, id),
    onSuccess: (run) => {
      invalidate()
      toast(`Run ${run.status} · ${nf.format(run.affected)} affected`, {
        variant: run.status === 'failed' ? 'error' : run.status === 'success' ? 'success' : 'warn',
      })
    },
    onError: (err) => toast(errorMessage(err, 'Could not run the automation'), { variant: 'error' }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => getApi().automation.automations.remove(workspaceId, id),
    onSuccess: () => {
      invalidate()
      toast('Automation removed', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not remove the automation'), { variant: 'error' }),
  })

  const automations = query.data ?? []
  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? 'table'

  return (
    <Card className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>Automations</h2>
        <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)} disabled={tablesLoading || tables.length === 0}>
          New automation
        </Button>
      </div>

      {query.isError ? (
        <Alert variant="error" title="Couldn’t load automations">
          {errorMessage(query.error)}
        </Alert>
      ) : query.isLoading ? (
        <ListSkeleton />
      ) : automations.length === 0 ? (
        <EmptyState title="No automations yet" description="Create a schedule or a row-event trigger to run columns automatically." />
      ) : (
        automations.map((a) => (
          <div key={a.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTop}>
                <span className={styles.name}>{a.name}</span>
                <Tag mono tone="default">
                  {triggerLabel(a)}
                </Tag>
                {a.action === 'run_column' ? (
                  <Tag tone="brand">{colName(columnsByTable, a.tableId, a.targetColumnId)}</Tag>
                ) : (
                  <Tag tone="cobalt">Whole table</Tag>
                )}
                {a.lastStatus && <Pill status={statusPill(a.lastStatus)}>{a.lastStatus}</Pill>}
              </div>
              <div className={styles.specs}>
                <span>{tableName(a.tableId)}</span>
                <span>{a.lastRunAt ? `last run ${formatDate(a.lastRunAt)}` : 'never run'}</span>
                {a.trigger === 'schedule' && a.nextRunAt && <span>next {formatDate(a.nextRunAt)}</span>}
                {a.forceFresh && <span>force fresh</span>}
              </div>
            </div>
            <div className={styles.rowActions}>
              <Switch
                checked={a.isEnabled}
                onCheckedChange={(enabled) => setEnabled.mutate({ id: a.id, enabled })}
                disabled={setEnabled.isPending}
                aria-label={`${a.isEnabled ? 'Disable' : 'Enable'} ${a.name}`}
              />
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => runNow.mutate(a.id)}
                disabled={runNow.isPending}
              >
                Run now
              </button>
              <button
                type="button"
                className={`${styles.linkBtn} ${styles.danger}`}
                onClick={() => remove.mutate(a.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      <AutomationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={workspaceId}
        tables={tables}
        columnsByTable={columnsByTable}
        onSaved={invalidate}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function WebhooksSection({
  workspaceId,
  tables,
  columnsByTable,
  tablesLoading,
}: {
  workspaceId: string
  tables: TableMeta[]
  columnsByTable: ColumnsByTable
  tablesLoading: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [inboundOpen, setInboundOpen] = useState(false)
  const [outboundOpen, setOutboundOpen] = useState(false)

  const inKey = ['webhooks', 'inbound', workspaceId]
  const outKey = ['webhooks', 'outbound', workspaceId]
  const inboundQuery = useQuery({ queryKey: inKey, queryFn: () => getApi().automation.webhooks.listInbound(workspaceId) })
  const outboundQuery = useQuery({ queryKey: outKey, queryFn: () => getApi().automation.webhooks.listOutbound(workspaceId) })

  const invalidateIn = () => void qc.invalidateQueries({ queryKey: inKey })
  const invalidateOut = () => void qc.invalidateQueries({ queryKey: outKey })
  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? 'table'
  const noTables = tablesLoading || tables.length === 0

  const setInboundEnabled = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => getApi().automation.webhooks.setInboundEnabled(workspaceId, v.id, v.enabled),
    onSuccess: invalidateIn,
    onError: (err) => toast(errorMessage(err, 'Could not update the webhook'), { variant: 'error' }),
  })
  const removeInbound = useMutation({
    mutationFn: (id: string) => getApi().automation.webhooks.removeInbound(workspaceId, id),
    onSuccess: () => {
      invalidateIn()
      toast('Inbound webhook removed', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not remove the webhook'), { variant: 'error' }),
  })
  const setOutboundEnabled = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => getApi().automation.webhooks.setOutboundEnabled(workspaceId, v.id, v.enabled),
    onSuccess: invalidateOut,
    onError: (err) => toast(errorMessage(err, 'Could not update the webhook'), { variant: 'error' }),
  })
  const removeOutbound = useMutation({
    mutationFn: (id: string) => getApi().automation.webhooks.removeOutbound(workspaceId, id),
    onSuccess: () => {
      invalidateOut()
      toast('Outbound webhook removed', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not remove the webhook'), { variant: 'error' }),
  })

  const inbound = inboundQuery.data ?? []
  const outbound = outboundQuery.data ?? []

  return (
    <Card className={styles.card}>
      {/* ---- Inbound ---- */}
      <div className={styles.subHead}>
        <h3>Inbound</h3>
        <Button variant="secondary" size="sm" onClick={() => setInboundOpen(true)} disabled={noTables}>
          New inbound webhook
        </Button>
      </div>
      {inboundQuery.isError ? (
        <Alert variant="error" title="Couldn’t load inbound webhooks">
          {errorMessage(inboundQuery.error)}
        </Alert>
      ) : inboundQuery.isLoading ? (
        <ListSkeleton rows={2} />
      ) : inbound.length === 0 ? (
        <EmptyState title="No inbound webhooks" description="Create an endpoint so external services can POST rows in." />
      ) : (
        inbound.map((w: InboundWebhook) => (
          <div key={w.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTop}>
                <span className={styles.name}>{w.name}</span>
                <Tag tone="default">{tableName(w.tableId)}</Tag>
                <Tag mono tone="default">
                  /in/{w.slug}
                </Tag>
              </div>
              <div className={styles.specs}>
                <span>secret {w.secretHint}</span>
                <span>{nf.format(w.receivedCount)} received</span>
                {w.lastReceivedAt && <span>last {formatDate(w.lastReceivedAt)}</span>}
              </div>
            </div>
            <div className={styles.rowActions}>
              <Switch
                checked={w.isEnabled}
                onCheckedChange={(enabled) => setInboundEnabled.mutate({ id: w.id, enabled })}
                aria-label={`${w.isEnabled ? 'Disable' : 'Enable'} ${w.name}`}
              />
              <button type="button" className={`${styles.linkBtn} ${styles.danger}`} onClick={() => removeInbound.mutate(w.id)}>
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      {/* ---- Outbound ---- */}
      <div className={`${styles.subHead} ${styles.subGap}`}>
        <h3>Outbound</h3>
        <Button variant="secondary" size="sm" onClick={() => setOutboundOpen(true)} disabled={noTables}>
          New outbound webhook
        </Button>
      </div>
      {outboundQuery.isError ? (
        <Alert variant="error" title="Couldn’t load outbound webhooks">
          {errorMessage(outboundQuery.error)}
        </Alert>
      ) : outboundQuery.isLoading ? (
        <ListSkeleton rows={2} />
      ) : outbound.length === 0 ? (
        <EmptyState title="No outbound webhooks" description="POST selected fields to an external URL when a row changes." />
      ) : (
        outbound.map((w: OutboundWebhook) => (
          <div key={w.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTop}>
                <span className={styles.name}>{w.name}</span>
                <Tag tone="default">{tableName(w.tableId)}</Tag>
                <Tag mono tone="default">
                  {w.event === 'record.created' ? 'on created' : 'on updated'}
                </Tag>
                {w.lastStatus && <Pill status={outboundPill(w.lastStatus)}>{w.lastStatus}</Pill>}
              </div>
              <div className={styles.specs}>
                <span>{w.url}</span>
                <span>{nf.format(w.deliveredCount)} delivered</span>
                {w.failedCount > 0 && <span>{nf.format(w.failedCount)} failed</span>}
              </div>
            </div>
            <div className={styles.rowActions}>
              <Switch
                checked={w.isEnabled}
                onCheckedChange={(enabled) => setOutboundEnabled.mutate({ id: w.id, enabled })}
                aria-label={`${w.isEnabled ? 'Disable' : 'Enable'} ${w.name}`}
              />
              <button type="button" className={`${styles.linkBtn} ${styles.danger}`} onClick={() => removeOutbound.mutate(w.id)}>
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      <InboundWebhookDialog
        open={inboundOpen}
        onOpenChange={setInboundOpen}
        workspaceId={workspaceId}
        tables={tables}
        columnsByTable={columnsByTable}
        onSaved={invalidateIn}
      />
      <OutboundWebhookDialog
        open={outboundOpen}
        onOpenChange={setOutboundOpen}
        workspaceId={workspaceId}
        tables={tables}
        columnsByTable={columnsByTable}
        onSaved={invalidateOut}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivitySection({ workspaceId }: { workspaceId: string }) {
  const [source, setSource] = useState<'all' | IntegrationEventSource>('all')

  const query = useQuery({
    queryKey: ['integration', 'events', workspaceId, source],
    queryFn: () =>
      getApi().integration.events(workspaceId, { limit: 50, ...(source !== 'all' ? { source } : {}) }),
  })
  const events = query.data ?? []

  return (
    <Card className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>Activity</h2>
        <Seg
          aria-label="Filter activity by source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All' },
            { value: 'schedule', label: 'Schedule' },
            { value: 'row_event', label: 'Row event' },
            { value: 'webhook_in', label: 'Inbound' },
            { value: 'webhook_out', label: 'Outbound' },
            { value: 'crm', label: 'CRM' },
            { value: 'slack', label: 'Slack' },
          ]}
        />
      </div>

      {query.isError ? (
        <Alert variant="error" title="Couldn’t load activity">
          {errorMessage(query.error)}
        </Alert>
      ) : query.isLoading ? (
        <ListSkeleton />
      ) : events.length === 0 ? (
        <EmptyState title="No activity yet" description="Automation runs, webhook deliveries, and syncs will appear here." />
      ) : (
        <div className={styles.feed}>
          {events.map((e: IntegrationEvent) => (
            <div key={e.id} className={styles.feedItem}>
              <Pill status={statusPill(e.status)}>{e.status}</Pill>
              <div className={styles.feedMain}>
                <span className={styles.feedSummary}>{e.summary}</span>
                <span className={styles.feedSource}>{SOURCE_LABEL[e.source]}</span>
              </div>
              <span className={styles.feedWhen}>{formatDate(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
