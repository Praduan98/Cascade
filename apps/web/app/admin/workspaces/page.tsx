'use client'
// Cross-workspace operations (US-4.5/4.6) — list every workspace with its plan,
// balance, usage, and margin; open one to suspend/reactivate, comp credits, or
// override the plan. Write actions are gated to Platform Admin (US-4.8) and every
// action is written to the platform audit log.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi, PLANS } from '@cascade/data'
import type { PlatformWorkspaceSummary } from '@cascade/data'
import { canIssueBillingExceptions, canOperateWorkspaces } from '@cascade/core'
import { Avatar, Button, ConfirmDialog, Dialog, DialogClose, EmptyState, Input, Pill, Select, useToast } from '@cascade/ui'
import { usePlatformSession } from '../PlatformSession'
import { errorMessage, initials } from '../../lib/ui'
import styles from '../admin.module.css'

const nf = new Intl.NumberFormat('en-US')
const usd = (n: number) => `$${nf.format(Math.round(n))}`

const STATUS_PILL: Record<string, 'success' | 'empty' | 'failed' | 'cached' | 'running'> = {
  active: 'success',
  trialing: 'running',
  past_due: 'empty',
  canceled: 'failed',
}

export default function PlatformWorkspacesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { platformUser } = usePlatformSession()
  const role = platformUser?.platformRole
  const canOperate = role ? canOperateWorkspaces(role) : false
  const canExcept = role ? canIssueBillingExceptions(role) : false

  const [openId, setOpenId] = useState<string | null>(null)
  const [compCredits, setCompCredits] = useState('')
  const [compReason, setCompReason] = useState('')
  const [planId, setPlanId] = useState('')

  const listQuery = useQuery({
    queryKey: ['platform', 'workspaces'],
    queryFn: () => getApi().platform.workspaces.list(),
  })
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data])
  const selected = rows.find((r) => r.workspace.id === openId) ?? null

  const membersQuery = useQuery({
    queryKey: ['platform', 'members', openId],
    queryFn: () => getApi().platform.workspaces.members(openId!),
    enabled: !!openId,
  })
  const invoicesQuery = useQuery({
    queryKey: ['platform', 'invoices', openId],
    queryFn: () => getApi().platform.invoices.list(openId!),
    enabled: !!openId,
  })

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['platform'] })
  }

  const suspend = useMutation({
    mutationFn: (v: { id: string; suspended: boolean }) => getApi().platform.workspaces.setSuspended(v.id, v.suspended, v.suspended ? 'suspended from platform' : 'reactivated from platform'),
    onSuccess: (_r, v) => { toast(v.suspended ? 'Workspace suspended' : 'Workspace reactivated', { variant: v.suspended ? 'warn' : 'success' }); invalidate() },
    onError: (e) => toast(errorMessage(e, 'Could not update workspace'), { variant: 'error' }),
  })
  const comp = useMutation({
    mutationFn: (v: { id: string; credits: number; reason: string }) => getApi().platform.workspaces.compCredits(v.id, v.credits, v.reason),
    onSuccess: () => { toast('Complimentary credits added', { variant: 'success' }); setCompCredits(''); setCompReason(''); invalidate() },
    onError: (e) => toast(errorMessage(e, 'Could not comp credits'), { variant: 'error' }),
  })
  const override = useMutation({
    mutationFn: (v: { id: string; planId: string }) => getApi().platform.workspaces.overridePlan(v.id, v.planId, 'platform override'),
    onSuccess: () => { toast('Plan overridden', { variant: 'success' }); invalidate() },
    onError: (e) => toast(errorMessage(e, 'Could not override plan'), { variant: 'error' }),
  })
  const deactivate = useMutation({
    mutationFn: (v: { id: string; userId: string }) => getApi().platform.workspaces.deactivateUser(v.id, v.userId, 'deactivated from platform'),
    onSuccess: () => { toast('User deactivated', { variant: 'warn' }); invalidate() },
    onError: (e) => toast(errorMessage(e, 'Could not deactivate user'), { variant: 'error' }),
  })
  const refund = useMutation({
    mutationFn: (invoiceId: string) => getApi().platform.invoices.refund(invoiceId, 'refunded from platform'),
    onSuccess: () => { toast('Refund issued', { variant: 'success' }); invalidate() },
    onError: (e) => toast(errorMessage(e, 'Could not issue refund'), { variant: 'error' }),
  })

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1>Workspaces</h1>
          <div className={styles.sub}>{rows.length ? `${rows.length} workspaces` : 'Loading…'}</div>
        </div>
      </div>

      <div className={styles.card}>
        {listQuery.isLoading ? (
          <div className={styles.skelBlock} style={{ height: 200, borderRadius: 8 }} />
        ) : rows.length === 0 ? (
          <EmptyState title="No workspaces" description="Customer workspaces will appear here." />
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Workspace</th><th scope="col">Plan</th><th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Balance</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Seats</th>
                  <th scope="col" style={{ textAlign: 'right' }}>MRR</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Margin</th>
                  <th scope="col"><span className={styles.srOnly}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.workspace.id}>
                    <td>
                      <span className={styles.wsCell}>
                        <Avatar initials={initials(r.workspace.name)} size={26} />
                        <span className={styles.wsName}><b>{r.workspace.name}</b><span>{r.ownerEmail}</span></span>
                      </span>
                    </td>
                    <td>{r.plan?.name ?? '—'}</td>
                    <td>
                      {r.suspended
                        ? <Pill status="failed">suspended</Pill>
                        : <Pill status={STATUS_PILL[r.status] ?? 'empty'}>{r.status}</Pill>}
                    </td>
                    <td className={styles.num}>{nf.format(r.balance)}</td>
                    <td className={styles.num}>{r.seats}</td>
                    <td className={styles.money}>{usd(r.mrrUsd)}</td>
                    <td className={styles.money}>{usd(r.mrrUsd - r.cogsUsd)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={['btn', 'btn-secondary', 'btn-sm', styles.rowBtn].join(' ')} onClick={() => { setOpenId(r.workspace.id); setPlanId(r.plan?.id ?? PLANS[0]!.id) }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={selected != null}
        onOpenChange={(o) => { if (!o) setOpenId(null) }}
        size="lg"
        title={selected?.workspace.name ?? ''}
        description={selected ? `${selected.ownerName} · ${selected.ownerEmail}` : undefined}
      >
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailKpis}>
              <div className={styles.detailKpi}><span className={styles.kpiLabel}>Balance</span><div className={styles.v}>{nf.format(selected.balance)} cr</div></div>
              <div className={styles.detailKpi}><span className={styles.kpiLabel}>MRR</span><div className={[styles.v, styles.money].join(' ')}>{usd(selected.mrrUsd)}</div></div>
              <div className={styles.detailKpi}><span className={styles.kpiLabel}>Margin</span><div className={[styles.v, styles.money].join(' ')}>{usd(selected.mrrUsd - selected.cogsUsd)}</div></div>
            </div>

            {!canOperate && !canExcept && (
              <p className={styles.sectionHint}>Support role — read-only. Ask a Platform Admin for account actions.</p>
            )}

            {canOperate && (
              <div className={styles.actionRow}>
                <span className={styles.lbl}>Account status</span>
                {selected.suspended ? (
                  <Button variant="secondary" size="sm" disabled={suspend.isPending} onClick={() => suspend.mutate({ id: selected.workspace.id, suspended: false })}>Reactivate workspace</Button>
                ) : (
                  <ConfirmDialog
                    trigger={<Button variant="danger" size="sm">Suspend workspace</Button>}
                    danger
                    title={`Suspend ${selected.workspace.name}?`}
                    description="The workspace loses access immediately and its enrichment jobs stop. You can reactivate it later."
                    confirmLabel="Suspend workspace"
                    onConfirm={async () => { await suspend.mutateAsync({ id: selected.workspace.id, suspended: true }) }}
                  />
                )}
              </div>
            )}

            {canExcept && (
              <>
                <div className={styles.actionRow}>
                  <span className={styles.lbl}>Comp credits</span>
                  <div className={styles.inlineForm}>
                    <Input type="number" min={0} placeholder="Credits" value={compCredits} onChange={(e) => setCompCredits(e.target.value)} aria-label="Comp credits" />
                    <Input placeholder="Reason" value={compReason} onChange={(e) => setCompReason(e.target.value)} aria-label="Reason" />
                    <Button variant="secondary" size="sm" disabled={comp.isPending || !Number(compCredits) || !compReason.trim()} onClick={() => comp.mutate({ id: selected.workspace.id, credits: Number(compCredits), reason: compReason })}>Add</Button>
                  </div>
                </div>
                <div className={styles.actionRow}>
                  <span className={styles.lbl}>Override plan</span>
                  <div className={styles.inlineForm}>
                    <Select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
                      {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name} · {usd(p.priceUsdMonthly)}/mo</option>)}
                    </Select>
                    <ConfirmDialog
                      trigger={<Button variant="danger" size="sm" disabled={override.isPending || planId === selected.plan?.id}>Apply</Button>}
                      danger
                      title={`Override ${selected.workspace.name}'s plan?`}
                      description={`This moves ${selected.workspace.name} to ${PLANS.find((p) => p.id === planId)?.name ?? 'the selected plan'} and changes what they are billed. The change is logged to the platform audit.`}
                      confirmLabel="Override plan"
                      onConfirm={async () => { await override.mutateAsync({ id: selected.workspace.id, planId }) }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Members (US-4.5) — view + deactivate a non-owner */}
            <div className={styles.actionRow}>
              <span className={styles.lbl}>Members</span>
              <div className={styles.miniList}>
                {(membersQuery.data ?? []).map((m) => (
                  <div key={m.id} className={styles.miniRow}>
                    <span className={styles.miniName}><b>{m.name}</b><span>{m.email} · {m.role}</span></span>
                    {canOperate && m.role !== 'owner' && (
                      <ConfirmDialog
                        trigger={<Button variant="danger" size="sm">Deactivate</Button>}
                        danger
                        title={`Deactivate ${m.name}?`}
                        description={`${m.name} (${m.email}) will lose access to ${selected.workspace.name} immediately. This is logged to the platform audit.`}
                        confirmLabel="Deactivate user"
                        onConfirm={async () => { await deactivate.mutateAsync({ id: selected.workspace.id, userId: m.userId }) }}
                      />
                    )}
                  </div>
                ))}
                {membersQuery.isLoading && <span className={styles.sectionHint}>Loading…</span>}
              </div>
            </div>

            {/* Invoices (US-4.6) — refund a paid invoice */}
            <div className={styles.actionRow}>
              <span className={styles.lbl}>Invoices</span>
              <div className={styles.miniList}>
                {(invoicesQuery.data ?? []).map((inv) => (
                  <div key={inv.id} className={styles.miniRow}>
                    <span className={styles.miniName}><b>{usd(inv.amountUsd)}</b><span>{inv.lines[0]?.label ?? 'invoice'}</span></span>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Pill status={inv.status === 'refunded' ? 'failed' : inv.status === 'paid' ? 'success' : 'empty'}>{inv.status}</Pill>
                      {canExcept && inv.status === 'paid' && (
                        <ConfirmDialog
                          trigger={<Button variant="danger" size="sm">Refund</Button>}
                          danger
                          title={`Refund ${usd(inv.amountUsd)}?`}
                          description={`This issues a ${usd(inv.amountUsd)} refund for "${inv.lines[0]?.label ?? 'invoice'}" to ${selected.workspace.name}. Refunds cannot be undone and are logged to the platform audit.`}
                          confirmLabel="Issue refund"
                          onConfirm={async () => { await refund.mutateAsync(inv.id) }}
                        />
                      )}
                    </span>
                  </div>
                ))}
                {invoicesQuery.isLoading && <span className={styles.sectionHint}>Loading…</span>}
                {!invoicesQuery.isLoading && (invoicesQuery.data ?? []).length === 0 && <span className={styles.sectionHint}>No invoices.</span>}
              </div>
            </div>

            <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
          </div>
        )}
      </Dialog>
    </div>
  )
}
