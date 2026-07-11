import { describe, expect, it } from 'vitest'
import { MockApi } from '../mockApi'
import { ForbiddenError, ValidationError } from '../errors'

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:platform:${keySeq++}` })
}
const OPS = 'ops@sdtcdigital.com' // platform admin
const SUPPORT = 'support@sdtcdigital.com' // platform support

describe('platform — separate auth (FR-4.2)', () => {
  it('requires a platform sign-in; workspace login grants no platform access', async () => {
    const a = api()
    // Signed in as a workspace owner, but NOT platform — no cross-tenant access.
    await expect(a.platform.workspaces.list()).rejects.toBeInstanceOf(ForbiddenError)
    // Platform sign-in is a wholly separate identity.
    const sess = await a.platform.auth.signIn(OPS)
    expect(sess.platformUser.platformRole).toBe('admin')
    expect(await a.platform.auth.currentSession()).toBeTruthy()
    const list = await a.platform.workspaces.list()
    expect(list.length).toBeGreaterThanOrEqual(6)
  })
})

describe('platform — workspace operations (US-4.5/4.6)', () => {
  it('admin can suspend a workspace and it is audited', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    const target = (await a.platform.workspaces.list()).find((w) => !w.suspended)!
    await a.platform.workspaces.setSuspended(target.workspace.id, true, 'abuse')
    const after = await a.platform.workspaces.get(target.workspace.id)
    expect(after.suspended).toBe(true)
    const audit = await a.platform.audit()
    expect(audit.some((e) => e.action === 'workspace.suspend' && e.targetId === target.workspace.id)).toBe(true)
  })

  it('admin comps credits, reconciling with the workspace ledger', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    const ws = (await a.platform.workspaces.list())[0]!.workspace.id
    const before = (await a.platform.workspaces.get(ws)).balance
    await a.platform.workspaces.compCredits(ws, 1000, 'goodwill')
    expect((await a.platform.workspaces.get(ws)).balance).toBe(before + 1000)
  })
})

describe('platform — RBAC (US-4.8)', () => {
  it('support can view but cannot suspend, comp, or refund', async () => {
    const a = api()
    await a.platform.auth.signIn(SUPPORT)
    // read paths allowed
    expect((await a.platform.workspaces.list()).length).toBeGreaterThan(0)
    expect((await a.platform.analytics()).mrrUsd).toBeGreaterThan(0)
    // write paths blocked
    const ws = (await a.platform.workspaces.list())[0]!.workspace.id
    await expect(a.platform.workspaces.setSuspended(ws, true, 'x')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(a.platform.workspaces.compCredits(ws, 100, 'reason')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(a.platform.workspaces.deactivateUser(ws, 'usr_member', 'x')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('platform — member management (US-4.5)', () => {
  it('lists a workspace’s members and can deactivate a non-owner, audited', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    const members = await a.platform.workspaces.members('ws_insightstap')
    expect(members.length).toBeGreaterThan(1)
    const nonOwner = members.find((m) => m.role !== 'owner')!
    await a.platform.workspaces.deactivateUser('ws_insightstap', nonOwner.userId, 'abuse')
    const after = await a.platform.workspaces.members('ws_insightstap')
    expect(after.some((m) => m.userId === nonOwner.userId)).toBe(false)
    expect((await a.platform.audit()).some((e) => e.action === 'user.deactivate')).toBe(true)
  })

  it('cannot deactivate the workspace owner', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    await expect(a.platform.workspaces.deactivateUser('ws_insightstap', 'usr_owner', 'x')).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('platform — billing exceptions require a reason (US-4.6)', () => {
  it('refund and comp reject a blank reason; refund flips invoice status', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    const ws = (await a.platform.workspaces.list())[0]!.workspace.id
    await expect(a.platform.workspaces.compCredits(ws, 100, '  ')).rejects.toBeInstanceOf(ValidationError)
    const invoices = await a.platform.invoices.list('ws_insightstap')
    expect(invoices.length).toBeGreaterThan(0)
    const inv = invoices.find((i) => i.status === 'paid')!
    await expect(a.platform.invoices.refund(inv.id, '')).rejects.toBeInstanceOf(ValidationError)
    const refunded = await a.platform.invoices.refund(inv.id, 'duplicate charge')
    expect(refunded.status).toBe('refunded')
  })
})

describe('platform — analytics (US-4.7)', () => {
  it('computes MRR, margin, and conversion from subscriptions/invoices/ledger', async () => {
    const a = api()
    await a.platform.auth.signIn(OPS)
    const m = await a.platform.analytics()
    // InsightsTap Growth + Northwind Growth + Zephyr Scale + SDTC Starter = 299+299+799+99
    expect(m.mrrUsd).toBe(1496)
    expect(m.arrUsd).toBe(1496 * 12)
    expect(m.cogsUsd).toBeGreaterThan(0)
    expect(m.grossMarginUsd).toBe(Math.round((/* revenue */ 1795 - m.cogsUsd) * 100) / 100)
    expect(m.mrrByPlan.length).toBeGreaterThan(0)
    expect(m.consumptionTrend.length).toBeGreaterThan(0)
  })
})
