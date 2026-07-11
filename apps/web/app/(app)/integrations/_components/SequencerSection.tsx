'use client'
// Outbound sequencers (Phase 4, US-4.10) — connect Instantly / Smartlead /
// HeyReach and push an enriched list into a campaign. Mirrors CrmSection:
// a list of connections (masked token, last push), per-connection push +
// disconnect, and a push-history table. Frontend-only on the mock API; the
// section is rendered by the admin-gated integrations page (canManageIntegrations).

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { SequencerConnection, SequencerProvider } from '@cascade/core'
import { Alert, Button, Card, EmptyState, Pill, Tag, useToast } from '@cascade/ui'
import { errorMessage, formatDate } from '../../../lib/ui'
import { ConnectSequencerDialog } from './ConnectSequencerDialog'
import { PushToSequencerDialog } from './PushToSequencerDialog'
import styles from '../integrations.module.css'

const SEQ_LABEL: Record<SequencerProvider, string> = {
  instantly: 'Instantly',
  smartlead: 'Smartlead',
  heyreach: 'HeyReach',
}

export function SequencerSection(props: { workspaceId: string }) {
  const { workspaceId } = props
  const qc = useQueryClient()
  const { toast } = useToast()
  const [connectOpen, setConnectOpen] = useState(false)
  const [pushTarget, setPushTarget] = useState<SequencerConnection | null>(null)

  const connectionsQuery = useQuery({
    queryKey: ['integration', 'sequencers', workspaceId],
    queryFn: () => getApi().integration.sequencers.list(workspaceId),
  })
  const runsQuery = useQuery({
    queryKey: ['integration', 'sequencers', 'runs', workspaceId],
    queryFn: () => getApi().integration.sequencers.pushRuns(workspaceId, { limit: 20 }),
  })

  const connections = connectionsQuery.data ?? []
  const runs = runsQuery.data ?? []

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['integration'] })
  }

  const disconnect = useMutation({
    mutationFn: (id: string) => getApi().integration.sequencers.disconnect(workspaceId, id),
    onSuccess: () => {
      toast('Sequencer disconnected', { variant: 'success' })
      invalidate()
    },
    onError: (e) => toast(errorMessage(e, 'Could not disconnect'), { variant: 'error' }),
  })

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Sequencer connections</h2>
          <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
            Connect sequencer
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
            title="No sequencer connected"
            description="Connect Instantly, Smartlead, or HeyReach to push an enriched list straight into a campaign."
          />
        ) : (
          connections.map((c) => (
            <div key={c.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <span className={styles.provName}>{SEQ_LABEL[c.provider]}</span>
                  <Tag mono tone="default">
                    {c.accountLabel}
                  </Tag>
                  {c.isConnected ? <Pill status="success">Connected</Pill> : <Pill status="failed">Disconnected</Pill>}
                </div>
                <div className={styles.specs}>
                  <span>{c.maskedToken}</span>
                  <span>{c.lastPushAt ? `last push ${formatDate(c.lastPushAt)}` : 'never pushed'}</span>
                </div>
              </div>
              <div className={styles.rowActions}>
                <Button variant="secondary" size="sm" disabled={!c.isConnected} onClick={() => setPushTarget(c)}>
                  Push list
                </Button>
                <button
                  type="button"
                  className={[styles.linkBtn, styles.danger].join(' ')}
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(c.id)}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Push history</h2>
          {runs.length > 0 && <span className={styles.sectionHint}>{runs.length} pushes</span>}
        </div>
        {runsQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 80, borderRadius: 8 }} />
        ) : runs.length === 0 ? (
          <EmptyState title="No pushes yet" description="Push a list to a campaign and its runs appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sequencer</th>
                  <th>Campaign</th>
                  <th>Result</th>
                  <th style={{ textAlign: 'right' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const noChange = r.created === 0 && r.failed === 0 && r.skipped === 0
                  return (
                    <tr key={r.id}>
                      <td>{SEQ_LABEL[r.provider]}</td>
                      <td>{r.campaignName}</td>
                      <td>
                        <span className={styles.counts}>
                          {r.created > 0 && <Pill status="success">{r.created} added</Pill>}
                          {r.failed > 0 && <Pill status="failed">{r.failed} failed</Pill>}
                          {r.skipped > 0 && <Pill status="empty">{r.skipped} skipped</Pill>}
                          {noChange && <Pill status="empty">no changes</Pill>}
                          {r.filterApplied && (
                            <Tag mono tone="cobalt">
                              filtered
                            </Tag>
                          )}
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

      <ConnectSequencerDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        workspaceId={workspaceId}
        onConnected={invalidate}
      />
      <PushToSequencerDialog
        open={pushTarget !== null}
        onOpenChange={(o) => {
          if (!o) setPushTarget(null)
        }}
        workspaceId={workspaceId}
        connectionId={pushTarget?.id ?? ''}
        onPushed={invalidate}
      />
    </>
  )
}
