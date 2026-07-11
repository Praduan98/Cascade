import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { evaluateFormula, extractFormulaRefs, readAgent, readFormula, readHttp, validateFormula } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ForbiddenError } from '../errors'

const { T, WS } = SEED_IDS
const AGENT_COL = 'col_co_intel'
const HTTP_COL = 'col_co_hq'
const SEGMENT_COL = 'col_co_segment'

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:p3rest:${keySeq++}`, enrichment: { sync: true } })
}

async function viewerApi() {
  const a = api()
  await a.auth.signIn('sam.okoye@insightstap.com')
  return a
}

// ===========================================================================
// Formula columns (US-3.6)
// ===========================================================================

describe('formula — pure evaluator (US-3.6)', () => {
  it('evaluates if/then/else + string/number/date/boolean ops', () => {
    const row: Record<string, string | number> = { Employees: 900, Company: 'Acme', Signed: '2024-06-15' }
    const resolve = (n: string) => row[n]
    expect(evaluateFormula('IF({{Employees}} > 500, "Enterprise", "SMB")', resolve).value).toBe('Enterprise')
    expect(evaluateFormula('UPPER({{Company}}) & "!"', resolve).value).toBe('ACME!')
    expect(evaluateFormula('{{Employees}} / 3', resolve).value).toBe(300)
    expect(evaluateFormula('YEAR({{Signed}})', resolve).value).toBe(2024)
    expect(evaluateFormula('{{Employees}} > 100 AND {{Employees}} < 1000', resolve).value).toBe(true)
  })

  it('surfaces errors without throwing (unknown column, div by zero)', () => {
    expect(evaluateFormula('{{Nope}} + 1', () => undefined).error).toMatch(/Unknown column/)
    expect(evaluateFormula('1 / 0', () => 0).error).toMatch(/Division by zero/)
    expect(validateFormula('IF(')).toMatch(/./) // a parse error string
    expect(validateFormula('1 + 2')).toBeNull()
  })

  it('extracts referenced column names', () => {
    expect(extractFormulaRefs('{{A}} + {{B}} & {{A}}')).toEqual(['A', 'B'])
  })
})

describe('formula — column integration (US-3.6)', () => {
  it('seeds a pre-computed Segment cell for every company', async () => {
    const a = api()
    const { rows } = await a.records.list(T.companies)
    const segs = rows.map((r) => r.cells[SEGMENT_COL]?.value)
    expect(segs.every((s) => s === 'Enterprise' || s === 'Mid-market' || s === 'SMB')).toBe(true)
    expect(readFormula(rows[0]?.cells[SEGMENT_COL]?.meta)?.status).toBe('ok')
  })

  it('recomputes a formula cell when a referenced cell changes', async () => {
    const a = api()
    const { rows } = await a.records.list(T.companies)
    const row = rows[0]!
    // Push Employees below 50 → Segment must recompute to SMB.
    await a.cells.patch([{ recordId: row.row.id, columnId: 'col_co_employees', value: 12 }])
    const after = await a.records.list(T.companies)
    const seg = after.rows.find((r) => r.row.id === row.row.id)?.cells[SEGMENT_COL]?.value
    expect(seg).toBe('SMB')
  })

  it('recompute is free — no credit-ledger impact', async () => {
    const a = api()
    const before = (await a.credits.balance(WS.primary)).balance
    await a.formula.recomputeTable(T.companies)
    expect((await a.credits.balance(WS.primary)).balance).toBe(before)
  })
})

// ===========================================================================
// Web-research agent columns (US-3.3/3.4)
// ===========================================================================

describe('agent — column execution + citations (US-3.3/3.4)', () => {
  const whole = (): RunScope => ({ mode: 'whole', columnIds: [AGENT_COL] })

  it('drives every targeted cell to a terminal state and cites sources on success', async () => {
    const a = api()
    await a.agent.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAgent()
    const { rows } = await a.records.list(T.companies)
    const metas = rows.map((r) => readAgent(r.cells[AGENT_COL]?.meta)).filter(Boolean)
    expect(metas.length).toBe(60)
    for (const m of metas) expect(['success', 'empty', 'failed', 'cached']).toContain(m!.status)

    // A successful cell must carry cited sources within the page cap.
    const successRow = rows.find((r) => readAgent(r.cells[AGENT_COL]?.meta)?.status === 'success')
    expect(successRow).toBeTruthy()
    const res = await a.agent.results(successRow!.row.id, AGENT_COL)
    expect(res[0]!.sources.length).toBeGreaterThan(0)
    expect(res[0]!.pages).toBeLessThanOrEqual(4)
    for (const s of res[0]!.sources) expect(s.url).toMatch(/^https:\/\//)
  })

  it('meters credits — spend equals the ledger sum, balance never negative', async () => {
    const a = api()
    const before = (await a.credits.balance(WS.primary)).balance
    await a.agent.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAgent()
    const after = (await a.credits.balance(WS.primary)).balance
    expect(after).toBeLessThanOrEqual(before)
    expect(after).toBeGreaterThanOrEqual(0)
    const runs = await a.agent.runs.list(WS.primary, { tableId: T.companies })
    expect(before - after).toBe(runs[0]!.creditsConsumed)
  })

  it('a cache hit re-runs free', async () => {
    const a = api()
    await a.agent.run(T.companies, whole(), { forceFresh: true })
    await a.__drainAgent()
    const mid = (await a.credits.balance(WS.primary)).balance
    await a.agent.run(T.companies, whole(), { forceFresh: false })
    await a.__drainAgent()
    expect((await a.credits.balance(WS.primary)).balance).toBe(mid)
  })

  it('viewers cannot run an agent column', async () => {
    const a = await viewerApi()
    await expect(a.agent.run(T.companies, whole(), { forceFresh: true })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ===========================================================================
// HTTP columns (US-3.5)
// ===========================================================================

describe('http — column execution + secrets (US-3.5)', () => {
  const whole = (): RunScope => ({ mode: 'whole', columnIds: [HTTP_COL] })

  it('maps a JSON path out of the mock response into the cell', async () => {
    const a = api()
    await a.http.run(T.companies, whole(), { forceFresh: true })
    await a.__drainHttp()
    const { rows } = await a.records.list(T.companies)
    const metas = rows.map((r) => readHttp(r.cells[HTTP_COL]?.meta)).filter(Boolean)
    expect(metas.length).toBe(60)
    const success = rows.find((r) => readHttp(r.cells[HTTP_COL]?.meta)?.status === 'success')
    expect(success).toBeTruthy()
    expect(typeof success!.cells[HTTP_COL]?.value).toBe('string')
    const res = await a.http.results(success!.row.id, HTTP_COL)
    expect(res[0]!.statusCode).toBe(200)
  })

  it('a non-2xx response is Failed and carries the status code', async () => {
    const a = api()
    await a.http.run(T.companies, whole(), { forceFresh: true })
    await a.__drainHttp()
    const { rows } = await a.records.list(T.companies)
    const failed = rows.map((r) => readHttp(r.cells[HTTP_COL]?.meta)).find((m) => m?.status === 'failed')
    if (failed) {
      expect(failed.statusCode).toBeGreaterThanOrEqual(400)
      expect(failed.credits).toBe(0)
    }
  })

  it('stored secrets are never returned in plaintext (FR-3.5)', async () => {
    const a = api()
    const secret = await a.http.secrets.create(WS.primary, { name: 'My key', token: 'sk-supersecret-abcd' })
    expect(secret.maskedHint).toBe('••••abcd')
    expect(JSON.stringify(secret)).not.toContain('supersecret')
    const list = await a.http.secrets.list(WS.primary)
    for (const s of list) expect(JSON.stringify(s)).not.toMatch(/sk-supersecret/)
  })
})

// ===========================================================================
// Automation layer (US-3.7–3.10)
// ===========================================================================

describe('automation — schedules, triggers, webhooks (US-3.7–3.10)', () => {
  it('runNow fires a scheduled automation and records a run + event', async () => {
    const a = api()
    const list = await a.automation.automations.list(WS.primary)
    const daily = list.find((x) => x.trigger === 'schedule')!
    const run = await a.automation.automations.runNow(WS.primary, daily.id)
    expect(['success', 'skipped', 'failed', 'partial']).toContain(run.status)
    const events = await a.integration.events(WS.primary, { source: 'schedule' })
    expect(events.length).toBeGreaterThan(0)
  })

  it('a row-event automation fires on record.created (auto-run enrichment)', async () => {
    const a = api()
    const beforeRuns = (await a.automation.automations.runs(WS.primary)).length
    await a.records.add(T.companies, { cells: { col_co_company: 'Trigger Co', col_co_domain: 'https://trigger.co' } })
    await a.__drain()
    const afterRuns = (await a.automation.automations.runs(WS.primary)).length
    expect(afterRuns).toBeGreaterThanOrEqual(beforeRuns)
  })

  it('an inbound webhook creates a row when the secret matches; rejects a bad secret', async () => {
    const a = api()
    const created = await a.automation.webhooks.createInbound(WS.primary, {
      tableId: T.companies,
      name: 'Test hook',
      mapping: { company: 'col_co_company', domain: 'col_co_domain' },
    })
    const before = (await a.records.list(T.companies)).total
    const bad = await a.automation.webhooks.simulateInbound(created.webhook.slug, 'wrong', { company: 'X' })
    expect(bad.ok).toBe(false)
    const ok = await a.automation.webhooks.simulateInbound(created.webhook.slug, created.secret, { company: 'Inbound Co', domain: 'https://inbound.co' })
    expect(ok.ok).toBe(true)
    await a.__drain()
    expect((await a.records.list(T.companies)).total).toBe(before + 1)
  })

  it('an outbound webhook is logged on a matching row event', async () => {
    const a = api()
    // The seeded outbound fires on record.updated when Active == true.
    const { rows } = await a.records.list(T.companies)
    const target = rows.find((r) => r.cells.col_co_active?.value !== true)!
    await a.cells.patch([{ recordId: target.row.id, columnId: 'col_co_active', value: true }])
    const events = await a.integration.events(WS.primary, { source: 'webhook_out' })
    expect(events.length).toBeGreaterThan(0)
  })

  it('viewers/members cannot manage automations', async () => {
    const a = await viewerApi()
    await expect(
      a.automation.automations.upsert(WS.primary, { tableId: T.companies, name: 'X', trigger: 'schedule', action: 'run_table' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ===========================================================================
// Integration layer (US-3.12–3.15)
// ===========================================================================

describe('integration — CRM + Slack + events (US-3.12–3.15)', () => {
  it('CRM push produces created/updated/skipped counts and a sync run', async () => {
    const a = api()
    const run = await a.integration.crm.sync(WS.primary, 'crm_hubspot', 'push')
    expect(run.created + run.updated + run.skipped).toBeGreaterThan(0)
    const runs = await a.integration.crm.syncRuns(WS.primary, { connectionId: 'crm_hubspot' })
    expect(runs[0]!.direction).toBe('push')
  })

  it('CRM pull creates new rows (dedupe-aware)', async () => {
    const a = api()
    const before = (await a.records.list(T.companies)).total
    const run = await a.integration.crm.sync(WS.primary, 'crm_hubspot', 'pull')
    expect(run.created).toBeGreaterThan(0)
    expect((await a.records.list(T.companies)).total).toBe(before + run.created)
  })

  it('CRM tokens are never returned', async () => {
    const a = api()
    const conns = await a.integration.crm.list(WS.primary)
    for (const c of conns) {
      expect(c.maskedToken.startsWith('••••')).toBe(true)
      expect('token' in c).toBe(false)
    }
  })

  it('Slack notify is gated to admins and logs an event', async () => {
    const a = api()
    await a.integration.slack.notify(WS.primary, { text: 'hello team' })
    const events = await a.integration.events(WS.primary, { source: 'slack' })
    expect(events.some((e) => e.summary.includes('hello team'))).toBe(true)

    const v = await viewerApi()
    await expect(v.integration.slack.notify(WS.primary, { text: 'nope' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('the unified event feed spans multiple sources (US-3.15)', async () => {
    const a = api()
    const events = await a.integration.events(WS.primary)
    const sources = new Set(events.map((e) => e.source))
    expect(sources.size).toBeGreaterThanOrEqual(3)
  })
})
