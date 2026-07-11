import { describe, expect, it } from 'vitest'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ForbiddenError, ValidationError } from '../errors'

const { WS, U, PLAN } = SEED_IDS

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:billing:${keySeq++}` })
}

describe('billing — plans + summary', () => {
  it('lists the plan catalog', async () => {
    const a = api()
    const plans = await a.billing.plans.list()
    expect(plans.map((p) => p.tier)).toEqual(['free', 'starter', 'growth', 'scale'])
  })

  it('summarizes the workspace plan, balance, and seats', async () => {
    const a = api()
    const s = await a.billing.summary(WS.primary)
    expect(s.plan?.id).toBe(PLAN.growth)
    expect(s.balance).toBe(18240)
    expect(s.includedCredits).toBe(20000)
    // 4 active members + 2 pending invites, limit 10 (Growth).
    expect(s.seats).toEqual({ used: 6, limit: 10 })
    expect(s.renewsAt).toBeTruthy()
  })
})

describe('billing — credit purchase (US-4.2, FR-4.1)', () => {
  it('grants credits to the ledger and reconciles the balance', async () => {
    const a = api()
    const before = (await a.credits.balance(WS.primary)).balance
    await a.billing.purchaseCredits(WS.primary, { credits: 5000, amountUsd: 50 })
    const after = (await a.credits.balance(WS.primary)).balance
    expect(after).toBe(before + 5000)
    // The purchase is a positive-delta ledger row (single source of truth).
    const ledger = await a.credits.ledger(WS.primary, { limit: 100 })
    const purchaseRow = ledger.find((e) => e.reason.startsWith('purchase:'))
    expect(purchaseRow?.delta).toBe(5000)
    expect(purchaseRow?.balanceAfter).toBe(after)
    // A paid invoice is recorded.
    const invoices = await a.billing.invoices(WS.primary)
    expect(invoices.some((i) => i.amountUsd === 50 && i.status === 'paid')).toBe(true)
  })
})

describe('billing — plan changes (US-4.4)', () => {
  it('upgrading tops the balance up to the included credits and is not farmable', async () => {
    const a = api()
    await a.billing.changePlan(WS.primary, PLAN.scale) // growth(18,240) → scale, top up to 60k
    expect((await a.credits.balance(WS.primary)).balance).toBe(60000)
    // Cycling down (to Growth, 10 seats — allowed) then back up must NOT re-grant.
    await a.billing.changePlan(WS.primary, PLAN.growth)
    expect((await a.credits.balance(WS.primary)).balance).toBe(60000)
    await a.billing.changePlan(WS.primary, PLAN.scale)
    expect((await a.credits.balance(WS.primary)).balance).toBe(60000) // no farming
  })

  it('blocks a downgrade whose seat limit is below current usage (US-4.4)', async () => {
    const a = api()
    // ws_insightstap uses 6 seats (4 members + 2 pending); Starter allows 3.
    await expect(a.billing.changePlan(WS.primary, PLAN.starter)).rejects.toBeInstanceOf(ValidationError)
  })

  it('cancel sets cancelAtPeriodEnd and drops the next charge', async () => {
    const a = api()
    const sub = await a.billing.setCancel(WS.primary, true)
    expect(sub.cancelAtPeriodEnd).toBe(true)
    expect((await a.billing.summary(WS.primary)).nextChargeUsd).toBe(0)
  })
})

describe('billing — seat limits (US-4.14)', () => {
  it('blocks invites beyond the plan seat limit', async () => {
    const a = api()
    // Fresh Free-plan workspace (limit 2): owner is 1 seat.
    await a.auth.signUp({ email: 'founder@newco.test', name: 'Fen', planId: PLAN.free })
    const { workspaces } = { workspaces: await a.workspaces.list() }
    const ws = workspaces[0]!.id
    await a.members.invite(ws, { email: 'a@newco.test', role: 'member' }) // seat 2 — ok
    await expect(a.members.invite(ws, { email: 'b@newco.test', role: 'member' })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('billing — roles', () => {
  it('only the owner can change the plan or buy credits', async () => {
    const a = api()
    await a.auth.switchUser(U.member) // member role in ws_insightstap
    await expect(a.billing.changePlan(WS.primary, PLAN.scale)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(a.billing.purchaseCredits(WS.primary, { credits: 5000, amountUsd: 50 })).rejects.toBeInstanceOf(ForbiddenError)
  })
})
