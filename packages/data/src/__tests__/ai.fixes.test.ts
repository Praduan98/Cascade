// Regression tests for the Phase-3 QA fixes. Each targets a confirmed finding
// and is written to FAIL against the pre-fix code.
import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { readAi, resolveTemplate, parseTemplate, validateStructured } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ValidationError } from '../errors'
import { buildAiCacheKey } from '../aiEngine'

const { T, WS, U } = SEED_IDS
const AI_COL = 'col_co_pitch'
const NOTES_COL = 'col_co_notes' // longText
const EMPLOYEES_COL = 'col_co_employees' // number

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:aifix:${keySeq++}`, enrichment: { sync: true } })
}
const whole = (): RunScope => ({ mode: 'whole', columnIds: [AI_COL] })
async function aiMetas(a: MockApi) {
  const { rows } = await a.records.list(T.companies)
  return rows.map((r) => readAi(r.cells[AI_COL]?.meta)).filter(Boolean)
}
async function baseCfg(a: MockApi) {
  return (await a.ai.configs.get(AI_COL))!
}

describe('fix #1: structured output coerces against the DESTINATION column type', () => {
  it('a mismatched field→column mapping does not crash the whole cell', async () => {
    const a = api()
    const cfg = await baseCfg(a)
    // A singleSelect field mapped to a longText column. Pre-fix: singleSelectDef
    // ran with a text config (no options) → findOption(undefined) throws →
    // resolveTarget catches → EVERY cell fails with 'unexpected error'.
    await a.ai.configs.upsert({
      columnId: AI_COL,
      model: cfg.model,
      operation: cfg.operation,
      promptTemplate: cfg.promptTemplate,
      outputSchema: [{ name: 'industry', type: 'singleSelect' }],
      outputMapping: { industry: NOTES_COL },
    })
    await a.ai.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAi()
    const metas = await aiMetas(a)
    expect(metas.length).toBe(60)
    expect(metas.filter((m) => m!.reason === 'unexpected error').length).toBe(0)
    expect(metas.some((m) => m!.status === 'success')).toBe(true)
  })

  it('validateStructured never throws on a select field with a non-select config', () => {
    // findOption guard: a config with no `options` degrades to "no match".
    const sv = validateStructured(
      { x: 'SaaS' },
      [{ name: 'x', type: 'singleSelect' }],
      () => ({ type: 'text' }) as never, // wrong-shaped config on purpose
    )
    expect(sv.fields.x?.ok).toBe(false) // not a valid option, but no crash
  })

  it('typeFor routes coercion to the destination type', () => {
    const sv = validateStructured(
      { x: 'hello' },
      [{ name: 'x', type: 'number' }], // declared number...
      () => ({ type: 'longText' }) as never,
      () => 'longText', // ...but lands in a text column → coerces as text
    )
    expect(sv.fields.x).toEqual({ ok: true, value: 'hello' })
  })
})

describe('fix #2: whitespace-only references are treated as missing', () => {
  it('resolveTemplate records a whitespace-only value as missing (matches isEmptyInput)', () => {
    const { missing } = resolveTemplate(parseTemplate('Hi {{Name}}'), () => '   ')
    expect(missing).toEqual(['Name'])
  })
})

describe('fix #3: anchor never writes raw, non-validating model text', () => {
  it('an AI column whose anchor is a number type does not store raw text', async () => {
    const a = api()
    const cfg = await baseCfg(a)
    // Point an AI config at a NUMBER anchor (Employees); summarize emits prose,
    // which must not be written raw into the number cell.
    await a.ai.configs.upsert({
      columnId: EMPLOYEES_COL,
      model: cfg.model,
      operation: 'summarize',
      promptTemplate: 'Describe {{Company}}',
      outputSchema: [],
      outputMapping: {},
    })
    await a.ai.run(T.companies, { mode: 'whole', columnIds: [EMPLOYEES_COL] }, { forceFresh: true })
    await a.__drainAi()
    const { rows } = await a.records.list(T.companies)
    for (const r of rows) {
      const v = r.cells[EMPLOYEES_COL]?.value
      // Every stored value is still a number (or null) — never prose.
      expect(v == null || typeof v === 'number').toBe(true)
    }
  })
})

describe('fix #4: AI cache key includes the output-schema fingerprint', () => {
  it('same model/op/prompt but different schema → different keys (no collision)', () => {
    const p = 'Extract contact for Acme'
    const k0 = buildAiCacheKey('claude-haiku-4-5', 'extract', p, [])
    const kA = buildAiCacheKey('claude-haiku-4-5', 'extract', p, [{ name: 'first', type: 'text' }])
    const kB = buildAiCacheKey('claude-haiku-4-5', 'extract', p, [{ name: 'email', type: 'email' }])
    expect(new Set([k0, kA, kB]).size).toBe(3)
  })
})

describe('fix #5: provider cost in AI config is Admin-only', () => {
  it('a member reading the config sees providerCostUsd 0; an admin sees the real cost', async () => {
    const a = api()
    const asOwner = await a.ai.configs.get(AI_COL)
    expect(asOwner!.providerCostUsd).toBeGreaterThan(0)
    await a.auth.switchUser(U.member)
    const asMember = await a.ai.configs.get(AI_COL)
    expect(asMember!.providerCostUsd).toBe(0)
    const listed = await a.ai.configs.list(T.companies)
    expect(listed.every((c) => c.providerCostUsd === 0)).toBe(true)
  })
})

describe('fix #6: a paused (overdrawn) enrichment run reconciles with the ledger', () => {
  it('run.creditsConsumed === -Σ ledger deltas and balance never goes negative', async () => {
    const a = api()
    a.rawStore.getWorkspaceCredit(WS.primary)!.balance = 5 // forces a mid-run pause
    const { runId } = await a.enrichment.run(T.companies, { mode: 'whole', columnIds: ['col_co_email'] }, { forceFresh: true })
    await a.__drainEnrichment()
    const run = await a.enrichment.runs.get(runId)
    const ledger = await a.credits.ledger(WS.primary, { runId })
    const sum = ledger.reduce((s, e) => s + e.delta, 0)
    expect(run.status).toBe('paused')
    expect(run.creditsConsumed).toBe(-sum) // refund keeps this exact
    expect((await a.credits.balance(WS.primary)).balance).toBeGreaterThanOrEqual(0)
  })
})

describe('fix #10/#11: seeded AI provenance + warm cache match a live run', () => {
  it('re-running the pitch column on the seeded row is a real free cache hit', async () => {
    const a = api()
    const scope: RunScope = { mode: 'selected', recordIds: ['rec_co_000'], columnIds: [AI_COL] }
    await a.ai.run(T.companies, scope) // no forceFresh → should hit the seeded warm cache
    await a.__drainAi()
    const { rows } = await a.records.list(T.companies)
    const meta = readAi(rows.find((r) => r.row.id === 'rec_co_000')?.cells[AI_COL]?.meta)
    expect(meta?.status).toBe('cached')
    expect(meta?.credits).toBe(0)
  })

  it('seeded provenance stores the real per-row resolved prompt, not a canned string', async () => {
    const a = api()
    const results = await a.ai.results('rec_co_000', AI_COL)
    expect(results[0]?.promptResolved).toContain('Northwind Traders') // rec_co_000
    expect(results[0]?.promptResolved).toContain('https://northwind.io')
    expect(results[0]?.promptResolved).not.toContain('from its fields') // the canned string is gone
  })
})

describe('fix #9: validateAiConfig rejects malformed input', () => {
  it('rejects unknown operation, unknown field type, and negative TTL', async () => {
    const a = api()
    const cfg = await baseCfg(a)
    const good = { columnId: AI_COL, model: cfg.model, promptTemplate: cfg.promptTemplate, outputSchema: [], outputMapping: {} }
    await expect(a.ai.configs.upsert({ ...good, operation: 'frobnicate' as never })).rejects.toBeInstanceOf(ValidationError)
    await expect(
      a.ai.configs.upsert({ ...good, operation: cfg.operation, outputSchema: [{ name: 'x', type: 'nope' as never }], outputMapping: {} }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(a.ai.configs.upsert({ ...good, operation: cfg.operation, cacheTtlDays: -5 })).rejects.toBeInstanceOf(ValidationError)
  })
})
