'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { canManageWorkspace, canWrite, ROLE_LABELS } from '@cascade/core'
import { Alert, Button, Card, Field, Input, RoleBadge, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage, formatDate } from '../../lib/ui'
import styles from './settings.module.css'

export default function SettingsPage() {
  const { workspace, role, membership } = useSession()
  const { toast } = useToast()
  const router = useRouter()
  const canManage = role ? canManageWorkspace(role) : false
  const writable = role ? canWrite(role) : false

  // Keep the trigger in a pending state through the navigation + destination
  // fetch that follows a successful reset, not just the async reset itself.
  const [isNavigating, startNavigation] = useTransition()

  const replayOnboarding = useMutation({
    mutationFn: () => getApi().onboarding.reset(workspace!.id),
    onSuccess: () => startNavigation(() => router.push('/onboarding')),
    onError: (err) => toast(errorMessage(err, 'Could not restart onboarding'), { variant: 'error' }),
  })

  const [name, setName] = useState(workspace?.name ?? '')

  // Keep the field in sync when the active workspace changes.
  useEffect(() => {
    setName(workspace?.name ?? '')
  }, [workspace?.id, workspace?.name])

  const membersQuery = useQuery({
    queryKey: ['members', workspace?.id],
    queryFn: () => getApi().members.list(workspace!.id),
    enabled: !!workspace,
  })

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          There&rsquo;s no active workspace to configure.
        </Alert>
      </div>
    )
  }

  const dirty = name.trim() !== workspace.name && name.trim().length > 0
  const memberCount = membersQuery.data?.length

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p>Manage your workspace.</p>
      </header>

      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h2>General</h2>
          <p>The workspace name is shown across the app and to your members.</p>
        </div>

        <div className={styles.formRow}>
          <Field label="Workspace name" htmlFor="ws-name">
            <Input
              id="ws-name"
              value={name}
              disabled={!canManage}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!canManage || !dirty}
            onClick={() =>
              toast('Workspace rename will persist once the backend lands (Phase 2).', {
                variant: 'warn',
              })
            }
          >
            Save
          </Button>
        </div>

        {canManage ? (
          <Alert variant="info" title="Not wired up yet">
            Renaming a workspace persists once the backend lands (Phase 2). The mock data layer has
            no workspace-update endpoint in Phase 1.
          </Alert>
        ) : (
          <Alert variant="info">Only the workspace owner can change these settings.</Alert>
        )}
      </Card>

      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h2>Details</h2>
          <p>Read-only information about this workspace.</p>
        </div>
        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Your role</span>
            <span className={styles.detailVal}>
              {membership ? <RoleBadge role={membership.role} /> : role ? ROLE_LABELS[role] : '—'}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Members</span>
            <span className={styles.detailVal}>
              {memberCount === undefined ? '—' : `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Created</span>
            <span className={styles.detailVal}>{formatDate(workspace.createdAt)}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Workspace ID</span>
            <span className={`${styles.detailVal} ${styles.mono}`}>{workspace.id}</span>
          </div>
        </div>
      </Card>

      {writable && (
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Getting started</h2>
            <p>Replay the guided onboarding to build and run a table from a template.</p>
          </div>
          <div className={styles.formRow}>
            <Button
              variant="secondary"
              loading={replayOnboarding.isPending || isNavigating}
              disabled={replayOnboarding.isPending || isNavigating}
              onClick={() => replayOnboarding.mutate()}
            >
              {replayOnboarding.isPending || isNavigating ? 'Starting…' : 'Replay onboarding'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
