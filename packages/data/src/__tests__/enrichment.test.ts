import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { readEnrichment } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { BudgetError, ForbiddenError, NotFoundError } from '../errors'

const { T, WS, U, P } = SEED_IDS
const EMAIL_COL = 'col_co_email'

let keySeq = 0
function api() {
  // A unique storage key per instance so persisted mutations (budget caps,
  // balances) never leak between tests. The engine runs synchronously so a run
  // is complete once run() resolves.
  return new MockApi({ latency: false, storageKey: `test:enr:${keySeq++}`, enrichment: { sync: true } })
}

const whole = (): RunScope => ({ mode: 'whole', columnIds: [EMAIL_COL] })

async function anchorMetas(a: MockApi) {
  const { rows } = await a.records.list(T.companies)
  return rows.map((r) => readEnrichment(r.cells[EMAIL_COL]?.meta)).filter(Boolean)
}

describe('enrichment — waterfall execution', () => {
  it('drives every targeted cell to a terminal state (no cell left queued/running)', async () => {
    const a = api()
    await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const metas = await anchorMetas(a)
    expect(metas.length).toBe(60)
    for (const m of metas) {
      expect(['success', 'empty', 'failed', 'cached']).toContain(m!.status)
    }
  })

  it('falls through PDL → Hunter: some values come from step 0 and some from step 1', async () => {
    const a = api()
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const metas = (await anchorMetas(a)).filter((m) => m!.status === 'success')
    const fromPdl = metas.filter((m) => m!.providerId === P.pdl).length
    const fromHunter = metas.filter((m) => m!.providerId === P.hunter).length
    expect(fromPdl).toBeGreaterThan(0)
    expect(fromHunter).toBeGreaterThan(0) // fall-through happened
    const run = await a.enrichment.runs.get(runId)
    expect(run.status).toBe('complete')
    expect(run.counts.processed).toBe(60)
  })
})

describe('enrichment — metering', () => {
  it('writes an atomic ledger: run.creditsConsumed === -Σ ledger deltas for the run', async () => {
    const a = api()
    const before = (await a.credits.balance(WS.primary)).balance
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    const entries = await a.credits.ledger(WS.primary, { runId })
    const sum = entries.reduce((s, e) => s + e.delta, 0)
    expect(run.creditsConsumed).toBe(-sum)
    const after = (await a.credits.balance(WS.primary)).balance
    expect(after).toBe(before - run.creditsConsumed)
    expect(after).toBeGreaterThanOrEqual(0)
  })

  it('cache hits are free: a second run without force-fresh charges nothing', async () => {
    const a = api()
    await a.enrichment.run(T.companies, whole())
    await a.__drainEnrichment()
    const midBalance = (await a.credits.balance(WS.primary)).balance
    const { runId } = await a.enrichment.run(T.companies, whole())
    await a.__drainEnrichment()
    const run2 = await a.enrichment.runs.get(runId)
    expect(run2.creditsConsumed).toBe(0)
    const cachedCount = (await anchorMetas(a)).filter((m) => m!.status === 'cached').length
    expect(cachedCount).toBeGreaterThan(0)
    expect((await a.credits.balance(WS.primary)).balance).toBe(midBalance)
  })

  it('force-fresh bypasses the cache and charges again', async () => {
    const a = api()
    await a.enrichment.run(T.companies, whole())
    await a.__drainEnrichment()
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    expect(run.creditsConsumed).toBeGreaterThan(0)
  })
})

describe('enrichment — budget caps (US-2.11)', () => {
  it('blocks a run whose estimate exceeds the per-run cap', async () => {
    const a = api()
    await a.credits.budget.set(WS.primary, { perRunCap: 1 })
    await expect(a.enrichment.run(T.companies, whole(), { forceFresh: true })).rejects.toBeInstanceOf(BudgetError)
    // nothing charged, balance intact
    expect((await a.credits.balance(WS.primary)).balance).toBe(18240)
  })

  it('pauses mid-run when the balance runs out; balance never goes negative', async () => {
    const a = api()
    a.rawStore.getWorkspaceCredit(WS.primary)!.balance = 8
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    expect(run.status).toBe('paused')
    expect((await a.credits.balance(WS.primary)).balance).toBeGreaterThanOrEqual(0)
  })
})

describe('enrichment — estimate + provenance', () => {
  it('estimates the maximum as billable rows × sum of step credits', async () => {
    const a = api()
    const est = await a.enrichment.estimate(T.companies, whole(), { forceFresh: true })
    expect(est.rows).toBe(60)
    expect(est.maxCredits).toBe(60 * 6) // 3 (PDL) + 2 (Hunter) + 1 (ZeroBounce)
  })

  it('persists provenance to cell.meta and survives a serialize/deserialize round-trip', async () => {
    const a = api()
    await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const json = a.rawStore.serialize()
    const parsed = JSON.parse(json).cells.find((c: { columnId: string; meta?: { enrichment?: { status: string } } }) => c.columnId === EMAIL_COL && c.meta?.enrichment)
    expect(parsed.meta.enrichment.status).toBeTruthy()
  })

  it('a row with a missing input resolves to Empty and consumes no credits', async () => {
    const a = api()
    const row = await a.records.add(T.companies, {}) // no domain → step-0 input missing
    const scope: RunScope = { mode: 'selected', recordIds: [row.row.id], columnIds: [EMAIL_COL] }
    const before = (await a.credits.balance(WS.primary)).balance
    await a.enrichment.run(T.companies, scope, { forceFresh: true })
    await a.__drainEnrichment()
    const { rows } = await a.records.list(T.companies)
    const meta = readEnrichment(rows.find((r) => r.row.id === row.row.id)?.cells[EMAIL_COL]?.meta)
    expect(meta?.status).toBe('empty')
    expect((await a.credits.balance(WS.primary)).balance).toBe(before)
  })
})

describe('enrichment — auto-run (US-2.7)', () => {
  it('enriches a newly added row when auto-run is enabled and inputs are present', async () => {
    const a = api()
    const cfg = await a.enrichment.configs.get(EMAIL_COL)
    await a.enrichment.configs.upsert({ columnId: EMAIL_COL, steps: cfg!.steps, autoRun: true })
    const row = await a.records.add(T.companies, { cells: { col_co_domain: 'https://newco.io' } })
    await a.__drainEnrichment()
    const { rows } = await a.records.list(T.companies)
    const meta = readEnrichment(rows.find((r) => r.row.id === row.row.id)?.cells[EMAIL_COL]?.meta)
    expect(meta).toBeTruthy()
    expect(['success', 'empty', 'failed', 'cached']).toContain(meta!.status)
  })
})

describe('enrichment — roles + isolation', () => {
  it('viewers cannot run enrichment', async () => {
    const a = api()
    await a.auth.switchUser(U.viewer)
    await expect(a.enrichment.run(T.companies, whole())).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('members cannot change the budget and do not see provider cost', async () => {
    const a = api()
    await a.auth.switchUser(U.member)
    await expect(a.credits.budget.set(WS.primary, { perRunCap: 100 })).rejects.toBeInstanceOf(ForbiddenError)
    const est = await a.enrichment.estimate(T.companies, whole())
    expect(est.maxProviderCostUsd).toBeNull()
  })

  it('enforces tenant isolation on another workspace’s table', async () => {
    const a = api()
    await a.auth.switchUser(U.member) // not a member of the SDTC workspace
    await expect(a.enrichment.estimate(T.accounts, { mode: 'whole', columnIds: [] })).rejects.toBeInstanceOf(NotFoundError)
  })
})
