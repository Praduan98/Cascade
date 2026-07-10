import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { readAi } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { BudgetError, ForbiddenError, NotFoundError } from '../errors'

const { T, WS, U } = SEED_IDS
const AI_COL = 'col_co_pitch'
const NOTES_COL = 'col_co_notes'

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:ai:${keySeq++}`, enrichment: { sync: true } })
}

const whole = (): RunScope => ({ mode: 'whole', columnIds: [AI_COL] })

async function aiMetas(a: MockApi) {
  const { rows } = await a.records.list(T.companies)
  return rows.map((r) => readAi(r.cells[AI_COL]?.meta)).filter(Boolean)
}

describe('ai — column execution (US-3.1)', () => {
  it('drives every targeted cell to a terminal state', async () => {
    const a = api()
    await a.ai.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAi()
    const metas = await aiMetas(a)
    expect(metas.length).toBe(60)
    for (const m of metas) {
      expect(['success', 'empty', 'failed', 'cached']).toContain(m!.status)
      expect(m!.modelKey).toBe('claude-haiku-4-5')
    }
  })

  it('a row with a missing {{reference}} resolves to Empty and consumes no credits', async () => {
    const a = api()
    const row = await a.records.add(T.companies, {}) // no Company/Domain/Employees
    const scope: RunScope = { mode: 'selected', recordIds: [row.row.id], columnIds: [AI_COL] }
    const before = (await a.credits.balance(WS.primary)).balance
    await a.ai.run(T.companies, scope, { forceFresh: true })
    await a.__drainAi()
    const { rows } = await a.records.list(T.companies)
    const meta = readAi(rows.find((r) => r.row.id === row.row.id)?.cells[AI_COL]?.meta)
    expect(meta?.status).toBe('empty')
    expect(meta?.reason).toMatch(/missing input/)
    expect((await a.credits.balance(WS.primary)).balance).toBe(before)
  })
})

describe('ai — structured output (US-3.2)', () => {
  it('fans a schema field out into a mapped, typed destination column', async () => {
    const a = api()
    const cfg = await a.ai.configs.get(AI_COL)
    await a.ai.configs.upsert({
      columnId: AI_COL,
      model: cfg!.model,
      operation: cfg!.operation,
      promptTemplate: cfg!.promptTemplate,
      outputSchema: [{ name: 'summary', type: 'longText' }],
      outputMapping: { summary: NOTES_COL },
    })
    await a.ai.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAi()
    const { rows } = await a.records.list(T.companies)
    const populated = rows.filter((r) => {
      const m = readAi(r.cells[NOTES_COL]?.meta)
      return m?.fieldName === 'summary'
    })
    // Most rows populate the field; a few may be Empty (repair/omit path).
    expect(populated.length).toBeGreaterThan(0)
  })
})

describe('ai — metering (US-3.11)', () => {
  it('writes an atomic ledger: run.creditsConsumed === -Σ ledger deltas', async () => {
    const a = api()
    const before = (await a.credits.balance(WS.primary)).balance
    const { runId } = await a.ai.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAi()
    const run = await a.ai.runs.get(runId)
    const entries = await a.credits.ledger(WS.primary, { runId })
    const sum = entries.reduce((s, e) => s + e.delta, 0)
    expect(run.creditsConsumed).toBe(-sum)
    const after = (await a.credits.balance(WS.primary)).balance
    expect(after).toBe(before - run.creditsConsumed)
    expect(after).toBeGreaterThanOrEqual(0)
  })

  it('cache hits are free: a second run without force-fresh charges nothing', async () => {
    const a = api()
    await a.ai.run(T.companies, whole())
    await a.__drainAi()
    const midBalance = (await a.credits.balance(WS.primary)).balance
    const { runId } = await a.ai.run(T.companies, whole())
    await a.__drainAi()
    const run2 = await a.ai.runs.get(runId)
    expect(run2.creditsConsumed).toBe(0)
    const cachedCount = (await aiMetas(a)).filter((m) => m!.status === 'cached').length
    expect(cachedCount).toBeGreaterThan(0)
    expect((await a.credits.balance(WS.primary)).balance).toBe(midBalance)
  })

  it('reports AI consumption grouped by model', async () => {
    const a = api()
    const buckets = await a.credits.consumptionByModel(WS.primary)
    const claude = buckets.find((b) => b.key === 'claude-haiku-4-5')
    expect(claude).toBeTruthy()
    expect(claude!.credits).toBeGreaterThanOrEqual(6) // seeded net-zero pair
  })
})

describe('ai — budget caps (US-3.11)', () => {
  it('blocks a run whose estimate exceeds the per-run cap', async () => {
    const a = api()
    await a.credits.budget.set(WS.primary, { perRunCap: 1 })
    await expect(a.ai.run(T.companies, whole(), { forceFresh: true })).rejects.toBeInstanceOf(BudgetError)
    expect((await a.credits.balance(WS.primary)).balance).toBe(18240)
  })

  it('pauses mid-run when the balance runs out; balance never goes negative', async () => {
    const a = api()
    a.rawStore.getWorkspaceCredit(WS.primary)!.balance = 5
    const { runId } = await a.ai.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAi()
    const run = await a.ai.runs.get(runId)
    expect(run.status).toBe('paused')
    expect((await a.credits.balance(WS.primary)).balance).toBeGreaterThanOrEqual(0)
  })
})

describe('ai — roles + isolation', () => {
  it('viewers cannot run AI columns', async () => {
    const a = api()
    await a.auth.switchUser(U.viewer)
    await expect(a.ai.run(T.companies, whole())).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('members do not see provider cost in the estimate', async () => {
    const a = api()
    await a.auth.switchUser(U.member)
    const est = await a.ai.estimate(T.companies, whole())
    expect(est.maxProviderCostUsd).toBeNull()
  })

  it('enforces tenant isolation on another workspace’s table', async () => {
    const a = api()
    await a.auth.switchUser(U.member)
    await expect(a.ai.estimate(T.accounts, { mode: 'whole', columnIds: [] })).rejects.toBeInstanceOf(NotFoundError)
  })
})
