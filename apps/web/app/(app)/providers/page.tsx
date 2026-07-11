'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Provider, ProviderCredential } from '@cascade/core'
import { canManageProviders } from '@cascade/core'
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogClose,
  EmptyState,
  Field,
  Input,
  Pill,
  ProvChip,
  Tag,
  useToast,
} from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage } from '../../lib/ui'
import styles from './providers.module.css'

const CATEGORY_LABEL: Record<Provider['category'], string> = {
  people: 'People / company',
  company: 'Company',
  email_find: 'Email finder',
  email_verify: 'Email verify',
  phone: 'Phone',
}

function LockGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default function ProvidersPage() {
  const { workspace, role } = useSession()
  const workspaceId = workspace?.id
  const authorized = role ? canManageProviders(role) : false

  const providersQuery = useQuery({
    queryKey: ['enrichment', 'providers', workspaceId],
    queryFn: () => getApi().enrichment.providers.list(workspaceId!),
    enabled: !!workspaceId && authorized,
  })
  const credsQuery = useQuery({
    queryKey: ['enrichment', 'credentials', workspaceId],
    queryFn: () => getApi().enrichment.credentials.list(workspaceId!),
    enabled: !!workspaceId && authorized,
  })

  const [keyTarget, setKeyTarget] = useState<Provider | null>(null)

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
          title="Providers & keys are restricted"
          description="Only owners and admins can view or configure provider credentials."
          action={
            <Link href="/tables">
              <Button variant="secondary">Back to tables</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const providers = providersQuery.data ?? []
  const creds = credsQuery.data ?? []
  const credFor = (providerId: string): ProviderCredential | undefined => creds.find((c) => c.providerId === providerId)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Providers &amp; keys</h1>
        <div className={styles.count}>
          {providersQuery.isLoading ? 'Loading…' : `${providers.length} providers · platform-managed & bring-your-own keys`}
        </div>
      </header>

      {credsQuery.isError && (
        <Alert variant="error" title="Couldn’t load credentials" className={styles.state}>
          {errorMessage(credsQuery.error)}
        </Alert>
      )}

      <Card className={styles.card}>
        {providersQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.skelBlock} style={{ width: 130, height: 24, borderRadius: 6 }} />
              <div className={styles.rowMain}>
                <div className={styles.skelBlock} style={{ height: 12, width: '40%' }} />
              </div>
            </div>
          ))
        ) : providers.length === 0 ? (
          <EmptyState title="No providers configured" />
        ) : (
          providers.map((p) => {
            const cred = credFor(p.id)
            const invalid = cred?.status === 'invalid'
            return (
              <div key={p.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <ProvChip mono={p.glyph} bg={p.monoColor}>
                      {p.name}
                    </ProvChip>
                    <Tag mono tone="default">
                      {CATEGORY_LABEL[p.category]}
                    </Tag>
                    {!cred || cred.status === 'missing' ? (
                      <Tag tone="default">Not configured</Tag>
                    ) : invalid ? (
                      <Pill status="failed">Key invalid</Pill>
                    ) : cred.isPlatformManaged ? (
                      <Pill status="cached">Platform-managed</Pill>
                    ) : (
                      <Pill status="success">Your key</Pill>
                    )}
                  </div>
                  <div className={styles.specs}>
                    <span>{p.defaultRateLimit}/s rate limit</span>
                    <span>{p.defaultTtlDays}d cache TTL</span>
                    {cred && !cred.isPlatformManaged && <span className={styles.keyHint}>{cred.maskedKey}</span>}
                  </div>
                  {invalid && (
                    <Alert variant="error" title="Provider key invalid">
                      {p.name} rejected the configured key (401). Update it to resume enrichment on this provider.
                    </Alert>
                  )}
                </div>
                <div className={styles.rowActions}>
                  {p.supportsByoKey ? (
                    <Button variant="secondary" size="sm" onClick={() => setKeyTarget(p)}>
                      {cred && !cred.isPlatformManaged ? 'Update key' : 'Add key'}
                    </Button>
                  ) : (
                    <span className={styles.keyHint}>Platform only</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>

      {workspaceId && keyTarget && (
        <KeyDialog provider={keyTarget} workspaceId={workspaceId} onClose={() => setKeyTarget(null)} />
      )}
    </div>
  )
}

function KeyDialog({ provider, workspaceId, onClose }: { provider: Provider; workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [apiKey, setApiKey] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['enrichment', 'credentials', workspaceId] })
    void qc.invalidateQueries({ queryKey: ['enrichment', 'providers', workspaceId] })
  }

  const upsert = useMutation({
    mutationFn: () => getApi().enrichment.credentials.upsert(workspaceId, { providerId: provider.id, apiKey, useByoKey: true }),
    onSuccess: (cred) => {
      invalidate()
      toast(cred.status === 'invalid' ? 'Key saved but looks invalid' : `Key saved for ${provider.name}`, {
        variant: cred.status === 'invalid' ? 'warn' : 'success',
      })
      onClose()
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the key'), { variant: 'error' }),
  })

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={`Connect ${provider.name}`}
      description="Bring your own API key. It’s stored masked and never shown again in full."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => upsert.mutate()} disabled={!apiKey.trim() || upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save key'}
          </Button>
        </>
      }
    >
      <Field label="API key" htmlFor="prov-key" hint="Paste the key from your provider dashboard.">
        <Input
          id="prov-key"
          type="password"
          autoFocus
          placeholder="sk_live_…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
    </Dialog>
  )
}
