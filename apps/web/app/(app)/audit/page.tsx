'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { AuditAction, AuditEntry } from '@cascade/core'
import { canViewAudit } from '@cascade/core'
import { Alert, Avatar, Button, EmptyState, Select } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, initials } from '../../lib/ui'
import styles from './audit.module.css'

// Human-readable verb for each audited action.
const ACTION_LABEL: Record<AuditAction, string> = {
  'table.create': 'created a table',
  'table.rename': 'renamed a table',
  'table.duplicate': 'duplicated a table',
  'table.delete': 'deleted a table',
  'column.add': 'added a column',
  'column.update': 'updated a column',
  'column.retype': 'changed a column type',
  'column.reorder': 'reordered columns',
  'column.remove': 'removed a column',
  'record.add': 'added a record',
  'record.bulkDelete': 'deleted records',
  'record.reorder': 'reordered a record',
  'csv.import': 'imported a CSV',
  'member.invite': 'invited a member',
  'member.updateRole': 'changed a role',
  'member.remove': 'removed a member',
  'invite.revoke': 'revoked an invitation',
  'view.create': 'created a view',
  'view.update': 'updated a view',
  'view.remove': 'deleted a view',
}

// A category colour per action family, used for the leading dot.
function actionColor(action: AuditAction): string {
  const family = action.split('.')[0]
  switch (family) {
    case 'table':
      return 'var(--brand)'
    case 'column':
      return 'var(--cobalt)'
    case 'member':
    case 'invite':
      return 'var(--gold)'
    case 'view':
      return 'var(--st-cached)'
    case 'csv':
      return 'var(--st-success)'
    default:
      return 'var(--text-3)'
  }
}

// Deterministic avatar colours (shared palette with the members screen).
const AVATAR_COLORS = ['#2fe6c8', '#4f9dff', '#38d08c', '#ab8cfb', '#f2666b', '#16b79e', '#f5b544']
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function avatarColor(seed: string): string {
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length] as string
}
function textOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a1114' : '#ffffff'
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

// A concise target label pulled from the entry's structured detail.
function targetLabel(e: AuditEntry): string {
  const d = e.detail ?? {}
  const from = asString(d.from)
  const to = asString(d.to)
  if (from && to) return `${from} → ${to}`
  const name = asString(d.name)
  if (name) return name
  const email = asString(d.email)
  if (email) return email
  if (to) return to
  if (typeof d.count === 'number') return `${d.count} record${d.count === 1 ? '' : 's'}`
  return e.targetType
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function AuditGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
    </svg>
  )
}

const ALL = '__all__'

export default function AuditPage() {
  const { workspace, role } = useSession()
  const workspaceId = workspace?.id
  const authorized = role ? canViewAudit(role) : false

  const [actionFilter, setActionFilter] = useState<string>(ALL)
  const [actorFilter, setActorFilter] = useState<string>(ALL)

  const auditQuery = useQuery({
    queryKey: ['audit', workspaceId],
    queryFn: () => getApi().audit.list(workspaceId!),
    enabled: !!workspaceId && authorized,
  })

  const entries = useMemo(() => auditQuery.data ?? [], [auditQuery.data])

  // Distinct actions / actors present, for the filter menus.
  const actionOptions = useMemo(() => {
    const set = new Set<AuditAction>()
    for (const e of entries) set.add(e.action)
    return Array.from(set).sort((a, b) => ACTION_LABEL[a].localeCompare(ACTION_LABEL[b]))
  }, [entries])

  const actorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of entries) map.set(e.actorUserId, e.actorName)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (actionFilter === ALL || e.action === actionFilter) &&
          (actorFilter === ALL || e.actorUserId === actorFilter),
      ),
    [entries, actionFilter, actorFilter],
  )

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          There&rsquo;s no active workspace to audit.
        </Alert>
      </div>
    )
  }

  // Gate: audit is Admin/Owner only.
  if (!authorized) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<LockGlyph />}
          title="Audit log is restricted"
          description="Only workspace owners and admins can view the activity log. Ask an admin if you need access."
          action={
            <Link href="/tables">
              <Button variant="secondary">Back to tables</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const hasFilters = actionFilter !== ALL || actorFilter !== ALL

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Audit log</h1>
          <div className={styles.count}>
            {auditQuery.isLoading
              ? 'Loading…'
              : `${entries.length} ${entries.length === 1 ? 'event' : 'events'} · append-only`}
          </div>
        </div>
      </header>

      {auditQuery.isError && (
        <Alert variant="error" title="Couldn’t load the audit log" className={styles.state}>
          {errorMessage(auditQuery.error)}
        </Alert>
      )}

      {!auditQuery.isLoading && entries.length > 0 && (
        <div className={styles.filters}>
          <Select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value={ALL}>All actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by actor"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          >
            <option value={ALL}>All members</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActionFilter(ALL)
                setActorFilter(ALL)
              }}
            >
              Clear
            </Button>
          )}
          <span className={styles.spacer} />
          <span className={styles.resultCount}>
            {filtered.length} of {entries.length}
          </span>
        </div>
      )}

      {auditQuery.isLoading ? (
        <div className={styles.tableWrap}>
          <div className={styles.table}>
            <div className={styles.headRow}>
              <span className={styles.th}>Actor</span>
              <span className={styles.th}>Action</span>
              <span className={styles.th}>Target</span>
              <span className={styles.th} style={{ textAlign: 'right' }}>
                When
              </span>
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skelRow}>
                <div className={styles.skelBlock} style={{ width: '70%' }} />
                <div className={styles.skelBlock} style={{ width: '80%' }} />
                <div className={styles.skelBlock} style={{ width: '60%' }} />
                <div className={styles.skelBlock} style={{ width: '90%' }} />
              </div>
            ))}
          </div>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          className={styles.state}
          icon={<AuditGlyph />}
          title="No activity yet"
          description="Workspace actions — creating tables, editing columns, inviting members — are recorded here as they happen."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          className={styles.state}
          icon={<AuditGlyph />}
          title="No matching activity"
          description="No events match the current filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setActionFilter(ALL)
                setActorFilter(ALL)
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.table}>
            <div className={styles.headRow}>
              <span className={styles.th}>Actor</span>
              <span className={styles.th}>Action</span>
              <span className={styles.th}>Target</span>
              <span className={styles.th} style={{ textAlign: 'right' }}>
                When
              </span>
            </div>
            {filtered.map((e) => {
              const bg = avatarColor(e.actorUserId || e.actorName)
              const label = targetLabel(e)
              const isTypeFallback = label === e.targetType
              return (
                <div key={e.id} className={styles.row}>
                  <div className={styles.actor}>
                    <Avatar initials={initials(e.actorName)} bg={bg} color={textOn(bg)} size={30} />
                    <span className={styles.actorName}>{e.actorName}</span>
                  </div>
                  <div className={styles.action}>
                    <span className={styles.dot} style={{ background: actionColor(e.action) }} />
                    <span className={styles.verb}>{ACTION_LABEL[e.action]}</span>
                  </div>
                  <span
                    className={`${styles.target} ${isTypeFallback ? styles.targetEmpty : ''}`}
                    title={label}
                  >
                    {label}
                  </span>
                  <span className={styles.when} title={e.createdAt}>
                    {formatDateTime(e.createdAt)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
