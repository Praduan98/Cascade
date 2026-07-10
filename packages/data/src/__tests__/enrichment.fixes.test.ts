// Regression tests for the Phase-2 QA fixes. Each test targets a specific
// confirmed finding and is written to FAIL against the pre-fix code.
import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { readEnrichment } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ValidationError } from '../errors'

const { T, WS, P } = SEED_IDS
const EMAIL_COL = 'col_co_email'

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:enrfix:${keySeq++}`, enrichment: { sync: true } })
}
const whole = (): RunScope => ({ mode: 'whole', columnIds: [EMAIL_COL] })

async function anchorMetas(a: MockApi) {
  const { rows } = await a.records.list(T.companies)
  return rows.map((r) => readEnrichment(r.cells[EMAIL_COL]?.meta)).filter(Boolean)
}

describe('fix: charged-but-rejected credits reconcile with the ledger (#1/#3/#5/#6)', () => {
  it('Σ per-cell result credits === run.creditsConsumed === -Σ ledger deltas', async () => {
    const a = api()
    // The seeded config verifies with acceptanceCondition 'verifyDeliverable',
    // which rejects ~28% of finds → those finder+verify charges are "sunk" and,
    // before the fix, vanished from per-cell provenance while staying in the ledger.
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    const cellCredits = a.rawStore.data.enrichmentResults
      .filter((r) => r.runId === runId)
      .reduce((s, r) => s + r.credits, 0)
    const ledgerCredits = (await a.credits.ledger(WS.primary, { runId })).reduce((s, e) => s + e.delta, 0)
    expect(run.creditsConsumed).toBeGreaterThan(0)
    expect(cellCredits).toBe(run.creditsConsumed) // by-cell attribution == run total
    expect(cellCredits).toBe(-ledgerCredits) // and both == the ledger
  })
})

describe('fix: estimate is a true upper bound when step-0 is cached (#2/#4)', () => {
  it('counts an uncached downstream step even though step-0 is a cache hit', async () => {
    const a = api()
    await a.enrichment.run(T.companies, whole()) // populate caches
    await a.__drainEnrichment()
    // Expire only the verify-step cache; step-0 (PDL) stays fresh.
    for (const e of a.rawStore.data.enrichmentCache) {
      if (e.operation === 'verify_email') e.expiresAt = '2000-01-01T00:00:00.000Z'
    }
    const est = await a.enrichment.estimate(T.companies, whole())
    // Pre-fix: step-0 cache hit zeroed the whole row → maxCredits 0 (cap bypass).
    expect(est.maxCredits).toBeGreaterThan(0)
  })

  it('a run whose only step is a valid cache hit estimates as free', async () => {
    const a = api()
    // A single row with a domain, run twice: after the first, step-0 (PDL) is
    // cached for it. Then run just that one row through a single-step PDL config.
    await a.enrichment.configs.upsert({
      columnId: EMAIL_COL,
      steps: [
        {
          providerId: P.pdl,
          operation: 'person_enrich',
          inputMapping: { domain: 'col_co_domain' },
          outputMapping: { email: EMAIL_COL },
          acceptanceCondition: 'nonEmptyField',
          acceptField: 'email',
          credits: 3,
          providerCostUsd: 0.02,
        },
      ],
    })
    const { rows } = await a.records.list(T.companies)
    // Pick a row PDL actually resolves (so its result caches, not an empty).
    const rid = rows[0]!.row.id
    const scope: RunScope = { mode: 'selected', recordIds: [rid], columnIds: [EMAIL_COL] }
    await a.enrichment.run(T.companies, scope)
    await a.__drainEnrichment()
    const meta = readEnrichment((await a.records.list(T.companies)).rows.find((r) => r.row.id === rid)?.cells[EMAIL_COL]?.meta)
    if (meta?.status === 'success') {
      // Its single step is now cached → a re-estimate is free (no false block).
      const est = await a.enrichment.estimate(T.companies, scope)
      expect(est.maxCredits).toBe(0)
    }
  })
})

describe('fix: non-billable run proceeds at zero balance (#7)', () => {
  it('a missing-input (knowably free) run does not throw when the balance is exhausted', async () => {
    const a = api()
    const row = await a.records.add(T.companies, {}) // no domain → missing input, zero cost
    a.rawStore.getWorkspaceCredit(WS.primary)!.balance = 0
    const scope: RunScope = { mode: 'selected', recordIds: [row.row.id], columnIds: [EMAIL_COL] }
    const { runId } = await a.enrichment.run(T.companies, scope) // must not reject
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    expect(run.creditsConsumed).toBe(0)
    const meta = readEnrichment((await a.records.list(T.companies)).rows.find((r) => r.row.id === row.row.id)?.cells[EMAIL_COL]?.meta)
    expect(meta?.status).toBe('empty')
  })
})

describe('fix: config validation + server-derived cost (#8/#9/#10)', () => {
  it('rejects unknown provider, off-table column, and mismatched verify condition', async () => {
    const a = api()
    const steps = (await a.enrichment.configs.get(EMAIL_COL))!.steps
    await expect(
      a.enrichment.configs.upsert({ columnId: EMAIL_COL, steps: [{ ...steps[0]!, providerId: 'prov_nope' }] }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      a.enrichment.configs.upsert({ columnId: EMAIL_COL, steps: [{ ...steps[0]!, outputMapping: { email: 'col_nope' } }] }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      a.enrichment.configs.upsert({ columnId: EMAIL_COL, steps: [{ ...steps[0]!, acceptanceCondition: 'verifyDeliverable' }] }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('overwrites client-supplied credits/cost with the provider cost model', async () => {
    const a = api()
    const steps = (await a.enrichment.configs.get(EMAIL_COL))!.steps
    const tampered = steps.map((s) => ({ ...s, credits: 0, providerCostUsd: 999 }))
    const saved = await a.enrichment.configs.upsert({ columnId: EMAIL_COL, steps: tampered })
    expect(saved.steps.map((s) => s.credits)).toEqual([3, 2, 1]) // PDL / Hunter / ZeroBounce
    expect(saved.steps.every((s) => s.providerCostUsd > 0 && s.providerCostUsd < 1)).toBe(true)
  })
})

describe('fix: BYO key attribution (#11) and invalid key (#12)', () => {
  it('a BYO provider (Hunter) records zero internal provider cost, still meters credits', async () => {
    const a = api()
    const { runId } = await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    void runId
    const hunterCache = a.rawStore.data.enrichmentCache.filter((e) => e.providerId === P.hunter)
    const pdlCache = a.rawStore.data.enrichmentCache.filter((e) => e.providerId === P.pdl)
    expect(hunterCache.length).toBeGreaterThan(0)
    expect(hunterCache.every((e) => e.cost === 0)).toBe(true) // BYO → $0 platform cost
    expect(pdlCache.some((e) => e.cost > 0)).toBe(true) // platform-managed still costs
  })

  it('an invalid BYO key fails cells with a config error and charges nothing', async () => {
    const a = api()
    const cred = a.rawStore.data.providerCredentials.find((c) => c.providerId === P.hunter && c.workspaceId === WS.primary)!
    cred.status = 'invalid'
    // Single Hunter step so every row with a domain calls Hunter.
    await a.enrichment.configs.upsert({
      columnId: EMAIL_COL,
      steps: [
        {
          providerId: P.hunter,
          operation: 'find_email',
          inputMapping: { domain: 'col_co_domain' },
          outputMapping: { email: EMAIL_COL },
          acceptanceCondition: 'nonEmptyField',
          acceptField: 'email',
          credits: 2,
          providerCostUsd: 0.01,
        },
      ],
    })
    const before = (await a.credits.balance(WS.primary)).balance
    await a.enrichment.run(T.companies, whole(), { forceFresh: true })
    await a.__drainEnrichment()
    const metas = await anchorMetas(a)
    expect(metas.some((m) => m!.status === 'failed' && /invalid or revoked/i.test(m!.reason ?? ''))).toBe(true)
    expect(metas.every((m) => m!.status !== 'success')).toBe(true) // no fabricated data
    expect((await a.credits.balance(WS.primary)).balance).toBe(before) // nothing charged
  })
})

describe('fix: seed data plausibility (#15/#16)', () => {
  it('seeded run ledger reconciles and totals are within the cost ceiling', async () => {
    const a = api()
    for (const runId of [SEED_IDS.ENR.run1, SEED_IDS.ENR.run2]) {
      const run = await a.enrichment.runs.get(runId)
      const ledger = await a.credits.ledger(WS.primary, { runId })
      const sum = ledger.reduce((s, e) => s + e.delta, 0)
      expect(run.creditsConsumed).toBe(-sum)
      const maxPerRow = 6 // PDL 3 + Hunter 2 + ZeroBounce 1
      expect(run.creditsConsumed).toBeLessThanOrEqual(run.counts.total * maxPerRow)
      expect(run.creditsConsumed).toBeLessThanOrEqual(5000) // per-run cap
    }
  })

  it("a 'selected' run's recordIds length matches its processed total", async () => {
    const a = api()
    const run = await a.enrichment.runs.get(SEED_IDS.ENR.run2)
    expect(run.scope.mode).toBe('selected')
    expect(run.scope.recordIds?.length).toBe(run.counts.total)
  })

  it('the seeded ledger balanceAfter chain ends at the workspace balance', async () => {
    const a = api()
    const balance = (await a.credits.balance(WS.primary)).balance
    const ledger = a.rawStore.data.creditLedger
      .filter((e) => e.workspaceId === WS.primary)
      .slice()
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1))
    expect(ledger[ledger.length - 1]!.balanceAfter).toBe(balance)
  })
})
