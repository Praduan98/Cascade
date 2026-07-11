'use client'
// Platform audit log (US-4.8) — append-only, viewable by platform staff. Every
// superadmin action (suspend, comp, refund, plan override) is recorded here.

import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { PlatformAuditAction } from '@cascade/core'
import { Avatar, EmptyState } from '@cascade/ui'
import { formatDate, initials } from '../../lib/ui'
import styles from '../admin.module.css'

const ACTION_LABEL: Record<PlatformAuditAction, string> = {
  'workspace.suspend': 'suspended a workspace',
  'workspace.reactivate': 'reactivated a workspace',
  'user.deactivate': 'deactivated a user',
  'credit.comp': 'comped credits',
  'refund.issue': 'issued a refund',
  'plan.override': 'overrode a plan',
}
const ACTION_COLOR: Record<string, string> = {
  workspace: 'var(--st-failed)',
  user: 'var(--st-failed)',
  credit: 'var(--gold)',
  refund: 'var(--gold)',
  plan: 'var(--cobalt)',
}

function detailText(detail: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof detail.credits === 'number') parts.push(`${detail.credits.toLocaleString('en-US')} cr`)
  if (typeof detail.amountUsd === 'number') parts.push(`$${detail.amountUsd}`)
  if (typeof detail.to === 'string') parts.push(`→ ${detail.to}`)
  if (typeof detail.reason === 'string' && detail.reason) parts.push(`· ${detail.reason}`)
  return parts.join(' ')
}

export default function PlatformAuditPage() {
  const auditQuery = useQuery({
    queryKey: ['platform', 'audit'],
    queryFn: () => getApi().platform.audit({ limit: 200 }),
  })
  const entries = auditQuery.data ?? []

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1>Platform audit</h1>
          <div className={styles.sub}>Append-only · every staff action is recorded</div>
        </div>
      </div>

      <div className={styles.card}>
        {auditQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 160, borderRadius: 8 }} />
        ) : entries.length === 0 ? (
          <EmptyState title="No platform actions yet" description="Suspends, comps, refunds and plan overrides appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr><th>Who</th><th>Action</th><th>Detail</th><th style={{ textAlign: 'right' }}>When</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const family = e.action.split('.')[0] ?? ''
                  return (
                    <tr key={e.id}>
                      <td>
                        <span className={styles.wsCell}>
                          <Avatar initials={initials(e.platformUserName)} size={24} bg="var(--gold)" color="var(--ground)" />
                          <span className={styles.wsName}><b>{e.platformUserName}</b></span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <i style={{ width: 7, height: 7, borderRadius: '50%', background: ACTION_COLOR[family] ?? 'var(--text-3)', flex: 'none' }} />
                          {ACTION_LABEL[e.action] ?? e.action}
                        </span>
                      </td>
                      <td className={styles.sectionHint} style={{ fontFamily: 'var(--font-mono)' }}>{detailText(e.detail)}</td>
                      <td className={styles.num} style={{ color: 'var(--text-3)' }}>{formatDate(e.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
