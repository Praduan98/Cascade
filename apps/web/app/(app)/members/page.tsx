'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Invite, Member as MemberRecord, Role } from '@cascade/core'
import { canManageMembers, ROLE_LABELS } from '@cascade/core'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Dialog,
  DialogClose,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Member,
  RoleBadge,
  Select,
  useToast,
} from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate, initials } from '../../lib/ui'
import styles from './members.module.css'

// Roles that can be assigned from this screen. Ownership transfer is a
// workspace-level action (Settings, Phase 2) and is intentionally excluded here.
const ASSIGNABLE_ROLES: Role[] = ['admin', 'member', 'viewer']

const ROLE_BLURB: Record<Role, string> = {
  owner: 'Full control — billing, roles, and deleting the workspace.',
  admin: 'Manage members and invitations, view the audit log, edit all data.',
  member: 'Create and edit tables, columns, records, and views.',
  viewer: 'Read-only access to tables and records.',
}

// ---- Deterministic avatar colours (from the design select palette) ----
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

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}
function MembersGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  )
}

export default function MembersPage() {
  const { workspace, role, user } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const canManage = role ? canManageMembers(role) : false
  const workspaceId = workspace?.id
  const currentUserId = user?.id

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [removeTarget, setRemoveTarget] = useState<MemberRecord | null>(null)

  const membersQuery = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => getApi().members.list(workspaceId!),
    enabled: !!workspaceId,
  })

  // listPendingInvites is admin+ only (the API 403s otherwise), so only fetch
  // when the acting user can actually manage members.
  const invitesQuery = useQuery({
    queryKey: ['pendingInvites', workspaceId],
    queryFn: () => getApi().members.listPendingInvites(workspaceId!),
    enabled: !!workspaceId && canManage,
  })

  function invalidateMembers() {
    void qc.invalidateQueries({ queryKey: ['members', workspaceId] })
  }
  function invalidateInvites() {
    void qc.invalidateQueries({ queryKey: ['pendingInvites', workspaceId] })
  }

  const inviteMutation = useMutation({
    mutationFn: (vars: { email: string; role: Role }) => getApi().members.invite(workspaceId!, vars),
    onSuccess: (invite) => {
      invalidateInvites()
      toast(`Invitation sent to ${invite.email}`, { variant: 'success' })
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('member')
    },
    onError: (err) => toast(errorMessage(err, 'Could not send the invitation'), { variant: 'error' }),
  })

  const roleMutation = useMutation({
    mutationFn: (vars: { memberId: string; role: Role }) =>
      getApi().members.updateRole(workspaceId!, vars.memberId, vars.role),
    onSuccess: (member) => {
      invalidateMembers()
      toast(`${member.name} is now ${ROLE_LABELS[member.role]}`, { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not change the role'), { variant: 'error' }),
  })

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => getApi().members.remove(workspaceId!, memberId),
    onSuccess: (_res, memberId) => {
      invalidateMembers()
      const name = removeTarget?.id === memberId ? removeTarget?.name : undefined
      toast(name ? `Removed ${name}` : 'Member removed', { variant: 'success' })
      setRemoveTarget(null)
    },
    onError: (err) => toast(errorMessage(err, 'Could not remove the member'), { variant: 'error' }),
  })

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => getApi().members.revokeInvite(workspaceId!, inviteId),
    onSuccess: () => {
      invalidateInvites()
      toast('Invitation revoked', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not revoke the invitation'), { variant: 'error' }),
  })

  // The mock API has no dedicated resend endpoint; revoking then re-inviting
  // issues a fresh pending invitation (a real backend would resend the email).
  const resendMutation = useMutation({
    mutationFn: async (invite: Invite) => {
      await getApi().members.revokeInvite(workspaceId!, invite.id)
      return getApi().members.invite(workspaceId!, { email: invite.email, role: invite.role })
    },
    onSuccess: (invite) => {
      invalidateInvites()
      toast(`Invitation re-sent to ${invite.email}`, { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not resend the invitation'), { variant: 'error' }),
  })

  function submitInvite() {
    const email = inviteEmail.trim()
    if (!email || inviteMutation.isPending) return
    inviteMutation.mutate({ email, role: inviteRole })
  }

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  const members = membersQuery.data ?? []
  const invites = invitesQuery.data ?? []
  const memberCount = members.length
  const pendingCount = invites.length

  const subtitle = membersQuery.isLoading
    ? 'Loading…'
    : `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` +
      (canManage && pendingCount > 0 ? ` · ${pendingCount} pending` : '') +
      ` in ${workspace.name}`

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Members</h1>
          <div className={styles.count}>{subtitle}</div>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        )}
      </header>

      {membersQuery.isError && (
        <Alert variant="error" title="Couldn’t load members" className={styles.state}>
          {errorMessage(membersQuery.error)}
        </Alert>
      )}

      {!canManage && !membersQuery.isLoading && (
        <Alert variant="info" title="Read-only access" className={styles.state}>
          Only owners and admins can invite people or change roles. You can see who has access below.
        </Alert>
      )}

      {/* ---- Members ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>People with access</h2>
          {!membersQuery.isLoading && (
            <span className={styles.sectionHint}>
              {memberCount} {memberCount === 1 ? 'seat' : 'seats'}
            </span>
          )}
        </div>

        {membersQuery.isLoading ? (
          <div className={styles.list}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skelRow}>
                <div className={`${styles.skelDot} ${styles.skelBlock}`} />
                <div className={styles.skelLines}>
                  <div className={styles.skelBlock} style={{ height: 12, width: '40%' }} />
                  <div className={styles.skelBlock} style={{ height: 10, width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.list}>
            {members.map((m, i) => {
              const isSelf = m.userId === currentUserId
              const isOwner = m.role === 'owner'
              const manageable = canManage && !isOwner && !isSelf
              const bg = avatarColor(m.userId || m.email)
              return (
                <Member
                  key={m.id}
                  last={i === members.length - 1}
                  avatar={<Avatar initials={initials(m.name)} bg={bg} color={textOn(bg)} size={32} />}
                  name={m.name}
                  email={m.email}
                  action={
                    <div className={styles.rowActions}>
                      {isSelf && <span className={styles.youTag}>You</span>}
                      <RoleBadge role={m.role} />
                      {manageable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className={styles.kebab} aria-label={`Manage ${m.name}`}>
                              <DotsIcon />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Change role</DropdownMenuLabel>
                            {ASSIGNABLE_ROLES.map((r) => (
                              <DropdownMenuItem
                                key={r}
                                disabled={r === m.role || roleMutation.isPending}
                                onSelect={() => roleMutation.mutate({ memberId: m.id, role: r })}
                              >
                                {ROLE_LABELS[r]}
                                {r === m.role ? ' · current' : ''}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem danger onSelect={() => setTimeout(() => setRemoveTarget(m), 0)}>
                              Remove from workspace
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  }
                />
              )
            })}
          </div>
        )}
      </Card>

      {/* ---- Pending invitations (managers only) ---- */}
      {canManage && (
        <Card className={styles.card}>
          <div className={styles.sectionHead}>
            <h2>Pending invitations</h2>
            {!invitesQuery.isLoading && pendingCount > 0 && (
              <span className={styles.sectionHint}>
                {pendingCount} {pendingCount === 1 ? 'invite' : 'invites'}
              </span>
            )}
          </div>

          {invitesQuery.isError ? (
            <Alert variant="error" title="Couldn’t load invitations">
              {errorMessage(invitesQuery.error)}
            </Alert>
          ) : invitesQuery.isLoading ? (
            <div className={styles.list}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={styles.skelRow}>
                  <div className={`${styles.skelDot} ${styles.skelBlock}`} />
                  <div className={styles.skelLines}>
                    <div className={styles.skelBlock} style={{ height: 12, width: '50%' }} />
                    <div className={styles.skelBlock} style={{ height: 10, width: '30%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : invites.length === 0 ? (
            <EmptyState
              title="No pending invitations"
              description="Invite teammates by email and they’ll appear here until they accept."
            />
          ) : (
            <div className={styles.list}>
              {invites.map((inv, i) => {
                const busy = revokeMutation.isPending || resendMutation.isPending
                return (
                  <Member
                    key={inv.id}
                    last={i === invites.length - 1}
                    avatar={<Avatar initials={initials(inv.email)} dashed size={32} />}
                    name={inv.email}
                    email={`Invited ${formatDate(inv.createdAt)} · Pending`}
                    action={
                      <div className={styles.pendingActions}>
                        <RoleBadge role={inv.role} />
                        <button
                          type="button"
                          className={styles.linkBtn}
                          disabled={busy}
                          onClick={() => resendMutation.mutate(inv)}
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          className={`${styles.linkBtn} ${styles.danger}`}
                          disabled={busy}
                          onClick={() => revokeMutation.mutate(inv.id)}
                        >
                          Revoke
                        </button>
                      </div>
                    }
                  />
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ---- Roles legend (seat model) ---- */}
      <Card className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>Roles &amp; seats</h2>
          <span className={styles.sectionHint}>every member holds one seat</span>
        </div>
        <div className={styles.roleGrid}>
          {(['owner', 'admin', 'member', 'viewer'] as Role[]).map((r) => (
            <div key={r} className={styles.roleRow}>
              <RoleBadge role={r} />
              <span className={styles.roleDesc}>{ROLE_BLURB[r]}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- Invite dialog ---- */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(o) => {
          if (!o && !inviteMutation.isPending) {
            setInviteOpen(false)
            setInviteEmail('')
            setInviteRole('member')
          } else if (o) {
            setInviteOpen(true)
          }
        }}
        title="Invite a member"
        description="They’ll get access to this workspace with the role you choose."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={submitInvite} disabled={!inviteEmail.trim() || inviteMutation.isPending}>
              {inviteMutation.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </>
        }
      >
        <Field label="Email address" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            autoFocus
            placeholder="teammate@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitInvite()
              }
            }}
          />
        </Field>
        <Field label="Role" htmlFor="invite-role" hint={ROLE_BLURB[inviteRole]}>
          <Select
            id="invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>

      {/* ---- Remove confirm ---- */}
      <Dialog
        open={removeTarget != null}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null)
        }}
        title="Remove member"
        description={
          removeTarget
            ? `${removeTarget.name} will lose access to “${workspace.name}”. You can invite them again later.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? 'Removing…' : 'Remove member'}
            </Button>
          </>
        }
      />

      {members.length === 0 && !membersQuery.isLoading && !membersQuery.isError && (
        <EmptyState className={styles.state} icon={<MembersGlyph />} title="No members yet" />
      )}
    </div>
  )
}
