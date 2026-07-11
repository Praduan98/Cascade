'use client'
// Integrations (Phase 3, US-3.12–3.15) — the admin surface for CRM connections
// (HubSpot / Salesforce / Pipedrive), Slack notifications, and the unified
// integration-event feed. Frontend-only on the mock API; admin+ gated
// (canManageIntegrations), which the API also enforces.

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type {
  CrmConnection,
  CrmProvider,
  CrmSyncDirection,
  IntegrationEventSource,
  IntegrationEventStatus,
} from '@cascade/core'
import { canManageIntegrations } from '@cascade/core'
import { Alert, Button, Card, ConfirmDialog, EmptyState, Field, Input, LockIcon, Pill, Seg, Tag, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate } from '../../lib/ui'
import { ConnectCrmDialog } from './_components/ConnectCrmDialog'
import { ConnectSlackDialog } from './_components/ConnectSlackDialog'
import { EditMappingDialog } from './_components/EditMappingDialog'
import { SequencerSection } from './_components/SequencerSection'
import styles from './integrations.module.css'

type Section = 'crm' | 'sequencers' | 'slack' | 'activity'

const CRM_LABEL: Record<CrmProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
}
const SOURCE_LABEL: Record<IntegrationEventSource, string> = {
  schedule: 'Schedule',
  row_event: 'Row event',
  webhook_in: 'Inbound webhook',
  webhook_out: 'Outbound webhook',
  crm: 'CRM',
  slack: 'Slack',
  sequencer: 'Sequencer',
}
const EVENT_STATUS: Record<IntegrationEventStatus, 'success' | 'cached' | 'failed' | 'empty'> = {
  success: 'success',
  partial: 'cached',
  failed: 'failed',
  skipped: 'empty',
}

function PlugGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v5" />
    </svg>
  )
}

/** Full-page header shown on every state (including gated/no-workspace ones). */
function PageHeader({ subtitle }: { subtitle: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headTitle}>
        <h1>Integrations</h1>
        <div className={styles.count}>{subtitle}</div>
      </div>
    </header>
  )
}

export default function IntegrationsPage() {
  const { workspace, role } = useSession()
  const authorized = role ? canManageIntegrations(role) : false
  const [section, setSection] = useState<Section>('crm')

  if (!workspace) {
    return (
      <div className={styles.page}>
        <PageHeader subtitle="CRM sync, Slack alerts & activity" />
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className={styles.page}>
        <PageHeader subtitle={`CRM sync, Slack alerts & activity for ${workspace.name}`} />
        <EmptyState
          icon={<LockIcon size={24} />}
          title="Integrations are restricted"
          description="Only owners and admins can connect CRMs, Slack, and view integration activity."
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
      <PageHeader subtitle={`CRM sync, Slack alerts & activity for ${workspace.name}`} />

      <div className={styles.tabs}>
        <Seg
          aria-label="Integration section"
          value={section}
          onChange={setSection}
          options={[
            { value: 'crm', label: 'CRM' },
            { value: 'sequencers', label: 'Sequencers' },
            { value: 'slack', label: 'Slack' },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </div>

      {section === 'crm' && <CrmSection workspaceId={workspace.id} />}
      {section === 'sequencers' && <SequencerSection workspaceId={workspace.id} />}
      {section === 'slack' && <SlackSection workspaceId={workspace.id} />}
      {section === 'activity' && <ActivitySection workspaceId={workspace.id} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

function CrmSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [connectOpen, setConnectOpen] = useState(false)
  const [mappingTarget, setMappingTarget] = useState<CrmConnection | null>(null)

  const connectionsQuery = useQuery({
    queryKey: ['integration', 'crm', workspaceId],
    queryFn: () => getApi().integration.crm.list(workspaceId),
  })
  const runsQuery = useQuery({
    queryKey: ['integration', 'crm', 'runs', workspaceId],
    queryFn: () => getApi().integration.crm.syncRuns(workspaceId, { limit: 20 }),
  })
  const tablesQuery = useQuery({
    queryKey: ['tables', workspaceId],
    queryFn: () => getApi().tables.list(workspaceId),
  })

  const connections = connectionsQuery.data ?? []
  const runs = runsQuery.data ?? []
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])
  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? id

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['integration'] })
  }

  const sync = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: CrmSyncDirection }) =>
      getApi().integration.crm.sync(workspaceId, id, direction),
    onSuccess: (run) => {
      const verb = run.direction === 'push' ? 'Pushed' : 'Pulled'
      toast(
        `${verb}: ${run.created} created, ${run.updated} updated, ${run.skipped} skipped${run.failed ? `, ${run.failed} failed` : ''}`,
        { variant: run.failed > 0 ? 'warn' : 'success' },
      )
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'The sync failed'), { variant: 'error' }),
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => getApi().integration.crm.disconnect(workspaceId, id),
    onSuccess: () => {
      toast('CRM disconnected', { variant: 'success' })
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not disconnect'), { variant: 'error' }),
  })

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>CRM connections</h2>
          <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
            Connect CRM
          </Button>
        </div>

        {connectionsQuery.isError && (
          <Alert variant="error" title="Couldn’t load connections">
            {errorMessage(connectionsQuery.error)}
          </Alert>
        )}

        {connectionsQuery.isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={styles.skelRow}>
              <div className={styles.skelLines}>
                <div className={styles.skelBlock} style={{ height: 14, width: '30%' }} />
                <div className={styles.skelBlock} style={{ height: 10, width: '55%' }} />
              </div>
            </div>
          ))
        ) : connections.length === 0 ? (
          <EmptyState
            icon={<PlugGlyph />}
            title="No CRM connected"
            description="Connect HubSpot, Salesforce, or Pipedrive to sync a table both ways."
            action={
              <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
                Connect CRM
              </Button>
            }
          />
        ) : (
          connections.map((c) => (
            <div key={c.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <span className={styles.provName}>{CRM_LABEL[c.provider]}</span>
                  <Tag mono tone="default">
                    {c.accountLabel}
                  </Tag>
                  {c.isConnected ? <Pill status="success">Connected</Pill> : <Pill status="failed">Disconnected</Pill>}
                </div>
                <div className={styles.specs}>
                  <span>{c.maskedToken}</span>
                  <span>table · {tableName(c.tableId)}</span>
                  <span>
                    {Object.keys(c.fieldMapping).length} field{Object.keys(c.fieldMapping).length === 1 ? '' : 's'} mapped
                  </span>
                  <span>{c.lastSyncAt ? `last sync ${formatDate(c.lastSyncAt)}` : 'never synced'}</span>
                </div>
              </div>
              <div className={styles.rowActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={sync.isPending}
                  onClick={() => sync.mutate({ id: c.id, direction: 'push' })}
                >
                  Push
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={sync.isPending}
                  onClick={() => sync.mutate({ id: c.id, direction: 'pull' })}
                >
                  Pull
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMappingTarget(c)}>
                  Edit mapping
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="danger" size="sm" disabled={disconnect.isPending}>
                      Disconnect
                    </Button>
                  }
                  title={`Disconnect ${CRM_LABEL[c.provider]}?`}
                  description="Syncing stops and the stored API token is removed. You’ll need to reconnect and re-enter the token to sync again."
                  danger
                  confirmLabel="Disconnect"
                  onConfirm={() => disconnect.mutate(c.id)}
                />
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Sync history</h2>
          {runs.length > 0 && <span className={styles.sectionHint}>{runs.length} runs</span>}
        </div>
        {runsQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 80, borderRadius: 8 }} />
        ) : runs.length === 0 ? (
          <EmptyState title="No syncs yet" description="Push or pull a connection and its runs appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Direction</th>
                  <th>Result</th>
                  <th style={{ textAlign: 'right' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const noChange = r.created === 0 && r.updated === 0 && r.skipped === 0 && r.failed === 0
                  return (
                    <tr key={r.id}>
                      <td>{CRM_LABEL[r.provider]}</td>
                      <td>
                        <Tag mono tone={r.direction === 'push' ? 'cobalt' : 'brand'}>
                          {r.direction}
                        </Tag>
                      </td>
                      <td>
                        <span className={styles.counts}>
                          {r.created > 0 && <Pill status="success">{r.created} created</Pill>}
                          {r.updated > 0 && <Pill status="cached">{r.updated} updated</Pill>}
                          {r.skipped > 0 && <Pill status="empty">{r.skipped} skipped</Pill>}
                          {r.failed > 0 && <Pill status="failed">{r.failed} failed</Pill>}
                          {noChange && <Pill status="empty">no changes</Pill>}
                        </span>
                      </td>
                      <td className={styles.when} style={{ textAlign: 'right' }}>
                        {formatDate(r.finishedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConnectCrmDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        workspaceId={workspaceId}
        tables={tables}
        onConnected={invalidate}
      />
      {mappingTarget && (
        <EditMappingDialog
          connection={mappingTarget}
          workspaceId={workspaceId}
          onClose={() => setMappingTarget(null)}
          onSaved={invalidate}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

function SlackSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [connectOpen, setConnectOpen] = useState(false)
  const [channel, setChannel] = useState('')
  const [text, setText] = useState('')

  const slackQuery = useQuery({
    queryKey: ['integration', 'slack', workspaceId],
    queryFn: () => getApi().integration.slack.get(workspaceId),
  })
  const slack = slackQuery.data

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['integration'] })
  }

  const notify = useMutation({
    mutationFn: () =>
      getApi().integration.slack.notify(workspaceId, { channel: channel.trim() || undefined, text: text.trim() }),
    onSuccess: () => {
      toast('Test message sent', { variant: 'success' })
      setText('')
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not send the message'), { variant: 'error' }),
  })
  const disconnect = useMutation({
    mutationFn: () => getApi().integration.slack.disconnect(workspaceId),
    onSuccess: () => {
      toast('Slack disconnected', { variant: 'success' })
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not disconnect Slack'), { variant: 'error' }),
  })

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Slack</h2>
          {slack && <span className={styles.sectionHint}>connected</span>}
        </div>

        {slackQuery.isError && (
          <Alert variant="error" title="Couldn’t load Slack">
            {errorMessage(slackQuery.error)}
          </Alert>
        )}

        {slackQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 90, borderRadius: 12 }} />
        ) : !slack ? (
          <EmptyState
            title="Slack not connected"
            description="Connect a Slack workspace to post alerts and automation notifications."
            action={
              <Button variant="primary" onClick={() => setConnectOpen(true)}>
                Connect Slack
              </Button>
            }
          />
        ) : (
          <>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <span className={styles.provName}>{slack.teamName}</span>
                  <Pill status="success">Connected</Pill>
                </div>
                <div className={styles.specs}>
                  <span>{slack.maskedToken}</span>
                  <span>default {slack.defaultChannel}</span>
                  <span>since {formatDate(slack.createdAt)}</span>
                </div>
              </div>
              <div className={styles.rowActions}>
                <ConfirmDialog
                  trigger={
                    <Button variant="danger" size="sm" disabled={disconnect.isPending}>
                      Disconnect
                    </Button>
                  }
                  title={`Disconnect ${slack.teamName}?`}
                  description="Alerts and automation notifications will stop posting to Slack, and the stored bot token is removed."
                  danger
                  confirmLabel="Disconnect"
                  onConfirm={() => disconnect.mutate()}
                />
              </div>
            </div>

            <div className={styles.testForm}>
              <Field label="Channel" htmlFor="slack-test-channel" hint="Leave blank to use the default channel.">
                <Input
                  id="slack-test-channel"
                  placeholder={slack.defaultChannel}
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                />
              </Field>
              <Field label="Message" htmlFor="slack-test-text">
                <Input
                  id="slack-test-text"
                  placeholder="Ping the team…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
              <div className={styles.testActions}>
                <Button
                  variant="secondary"
                  onClick={() => notify.mutate()}
                  disabled={!text.trim() || notify.isPending}
                >
                  {notify.isPending ? 'Sending…' : 'Send test message'}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <ConnectSlackDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        workspaceId={workspaceId}
        onConnected={invalidate}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

type ActivityFilter = 'all' | 'crm' | 'slack' | 'automation' | 'webhook'

function matchesFilter(source: IntegrationEventSource, filter: ActivityFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'crm':
      return source === 'crm'
    case 'slack':
      return source === 'slack'
    case 'automation':
      return source === 'schedule' || source === 'row_event'
    case 'webhook':
      return source === 'webhook_in' || source === 'webhook_out'
  }
}

function ActivitySection({ workspaceId }: { workspaceId: string }) {
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const eventsQuery = useQuery({
    queryKey: ['integration', 'events', workspaceId],
    queryFn: () => getApi().integration.events(workspaceId, { limit: 50 }),
  })
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data])
  const filtered = useMemo(() => events.filter((e) => matchesFilter(e.source, filter)), [events, filter])

  return (
    <Card className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>Activity</h2>
        <Seg
          aria-label="Filter activity by source"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'crm', label: 'CRM' },
            { value: 'slack', label: 'Slack' },
            { value: 'automation', label: 'Automations' },
            { value: 'webhook', label: 'Webhooks' },
          ]}
        />
      </div>

      {eventsQuery.isError && (
        <Alert variant="error" title="Couldn’t load activity">
          {errorMessage(eventsQuery.error)}
        </Alert>
      )}

      {eventsQuery.isLoading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skelRow}>
            <div className={styles.skelLines}>
              <div className={styles.skelBlock} style={{ height: 12, width: '20%' }} />
              <div className={styles.skelBlock} style={{ height: 10, width: '60%' }} />
            </div>
          </div>
        ))
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No activity"
          description="Events from CRM syncs, Slack, automations, and webhooks appear here."
        />
      ) : (
        <ul className={styles.feed}>
          {filtered.map((e) => (
            <li key={e.id} className={styles.feedRow}>
              <Pill status={EVENT_STATUS[e.status]}>{e.status}</Pill>
              <div className={styles.feedMain}>
                <div className={styles.feedTop}>
                  <Tag mono tone="default">
                    {SOURCE_LABEL[e.source]}
                  </Tag>
                  <span className={styles.feedSummary}>{e.summary}</span>
                </div>
              </div>
              <span className={styles.feedWhen}>{formatDate(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
