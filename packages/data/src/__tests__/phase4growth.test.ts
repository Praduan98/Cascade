import { describe, expect, it } from 'vitest'
import { readFormula } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ForbiddenError } from '../errors'

const { T, WS } = SEED_IDS

let keySeq = 0
function api() {
  return new MockApi({ latency: false, storageKey: `test:p4growth:${keySeq++}`, enrichment: { sync: true } })
}
async function viewerApi() {
  const a = api()
  await a.auth.signIn('sam.okoye@insightstap.com')
  return a
}

// ===========================================================================
// Templates (US-4.9)
// ===========================================================================

describe('templates — library + instantiate (US-4.9)', () => {
  it('lists a curated, non-empty library each with a per-row credit estimate', async () => {
    const a = api()
    const list = await a.templates.list()
    expect(list.length).toBeGreaterThanOrEqual(4)
    for (const t of list) {
      expect(t.columns.length).toBeGreaterThan(0)
      expect(typeof t.creditsPerRow).toBe('number')
    }
  })

  it('instantiating an enrichment template creates a runnable table with configured columns + sample rows', async () => {
    const a = api()
    const table = await a.templates.instantiate(WS.primary, 'tpl_company_email')
    expect(table.workspaceId).toBe(WS.primary)

    const cols = await a.columns.list(table.id)
    expect(cols.map((c) => c.name)).toContain('Work email')

    // The email column carries a configured waterfall, ready to run.
    const configs = await a.enrichment.configs.list(table.id)
    const emailCol = cols.find((c) => c.name === 'Work email')!
    const emailCfg = configs.find((c) => c.columnId === emailCol.id)
    expect(emailCfg?.steps.length).toBeGreaterThan(0)
    expect(emailCfg?.steps[0]?.providerId).toBeTruthy()

    // Sample rows seeded.
    const { total } = await a.records.list(table.id)
    expect(total).toBeGreaterThan(0)

    // And it actually runs end-to-end.
    await a.enrichment.run(table.id, { mode: 'whole', columnIds: [emailCol.id] }, { forceFresh: true })
    await a.__drain()
    const runs = await a.enrichment.runs.list(WS.primary, { tableId: table.id })
    expect(runs[0]?.counts.processed).toBeGreaterThan(0)
  })

  it('instantiating a template with a formula pre-computes the formula cells', async () => {
    const a = api()
    const table = await a.templates.instantiate(WS.primary, 'tpl_ai_lead_scoring')
    const cols = await a.columns.list(table.id)
    const seg = cols.find((c) => c.name === 'Segment')!
    const empId = cols.find((c) => c.name === 'Employees')!.id
    const { rows } = await a.records.list(table.id)
    const withEmp = rows.find((r) => r.cells[empId]?.value != null)
    expect(withEmp).toBeTruthy()
    const segVal = withEmp!.cells[seg.id]?.value
    expect(['Enterprise', 'Mid-market', 'SMB']).toContain(segVal)
    expect(readFormula(withEmp!.cells[seg.id]?.meta)?.status).toBe('ok')
  })

  it('instantiating the same template twice auto-suffixes the table name', async () => {
    const a = api()
    const t1 = await a.templates.instantiate(WS.primary, 'tpl_blank_companies', { tableName: 'My table' })
    const t2 = await a.templates.instantiate(WS.primary, 'tpl_blank_companies', { tableName: 'My table' })
    expect(t1.name).toBe('My table')
    expect(t2.name).not.toBe('My table')
    expect(t2.name).toMatch(/My table/)
  })

  it('viewers cannot instantiate a template', async () => {
    const a = await viewerApi()
    await expect(a.templates.instantiate(WS.primary, 'tpl_company_email')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ===========================================================================
// Outbound sequencers (US-4.10)
// ===========================================================================

describe('sequencers — connect + push (US-4.10)', () => {
  it('connects with a masked token that is never returned in plaintext', async () => {
    const a = api()
    const conn = await a.integration.sequencers.connect(WS.primary, { provider: 'smartlead', token: 'sl-secret-token-9999', accountLabel: 'Test' })
    expect(conn.maskedToken).toBe('••••9999')
    expect(JSON.stringify(conn)).not.toContain('secret-token')
    const list = await a.integration.sequencers.list(WS.primary)
    for (const c of list) expect('token' in c).toBe(false)
  })

  it('pushes mapped rows to a campaign and reports created/failed/skipped + a history row', async () => {
    const a = api()
    const conns = await a.integration.sequencers.list(WS.primary)
    const conn = conns[0]!
    const campaigns = await a.integration.sequencers.campaigns(WS.primary, conn.id)
    expect(campaigns.length).toBeGreaterThan(0)
    const run = await a.integration.sequencers.push(WS.primary, conn.id, {
      tableId: T.companies,
      campaignId: campaigns[0]!.id,
      campaignName: campaigns[0]!.name,
      fieldMapping: { col_co_email: 'email', col_co_company: 'company' },
    })
    // Of the pushed rows, each lands as created / failed / already-in-campaign.
    expect(run.created + run.failed).toBeLessThanOrEqual(run.pushed)
    expect(run.pushed).toBeGreaterThan(0)
    const runs = await a.integration.sequencers.pushRuns(WS.primary, { connectionId: conn.id })
    expect(runs.some((r) => r.id === run.id)).toBe(true)
    const events = await a.integration.events(WS.primary, { source: 'sequencer' })
    expect(events.length).toBeGreaterThan(0)
  })

  it('a filter reduces the pushed set (US-4.10 conditional push)', async () => {
    const a = api()
    const conn = (await a.integration.sequencers.list(WS.primary))[0]!
    const camps = await a.integration.sequencers.campaigns(WS.primary, conn.id)
    const base = await a.integration.sequencers.push(WS.primary, conn.id, {
      tableId: T.companies, campaignId: camps[0]!.id, campaignName: camps[0]!.name,
      fieldMapping: { col_co_email: 'email' },
    })
    const filtered = await a.integration.sequencers.push(WS.primary, conn.id, {
      tableId: T.companies, campaignId: camps[0]!.id, campaignName: camps[0]!.name,
      fieldMapping: { col_co_email: 'email' },
      filter: { columnId: 'col_co_active', op: 'equals', value: 'true' },
    })
    expect(filtered.filterApplied).toBe(true)
    expect(filtered.pushed).toBeLessThanOrEqual(base.pushed)
  })

  it('a push without an email mapping is rejected', async () => {
    const a = api()
    const conn = (await a.integration.sequencers.list(WS.primary))[0]!
    const camps = await a.integration.sequencers.campaigns(WS.primary, conn.id)
    await expect(
      a.integration.sequencers.push(WS.primary, conn.id, { tableId: T.companies, campaignId: camps[0]!.id, campaignName: camps[0]!.name, fieldMapping: { col_co_company: 'company' } }),
    ).rejects.toThrow(/email/i)
  })

  it('connecting a sequencer is admin-gated; pushing is allowed for members', async () => {
    const v = await viewerApi()
    await expect(v.integration.sequencers.connect(WS.primary, { provider: 'heyreach', token: 't', accountLabel: 'x' })).rejects.toBeInstanceOf(ForbiddenError)

    const member = api()
    await member.auth.signIn('dana.whitfield@insightstap.com')
    const conn = (await member.integration.sequencers.list(WS.primary))[0]!
    const camps = await member.integration.sequencers.campaigns(WS.primary, conn.id)
    const run = await member.integration.sequencers.push(WS.primary, conn.id, { tableId: T.companies, campaignId: camps[0]!.id, campaignName: camps[0]!.name, fieldMapping: { col_co_email: 'email' } })
    expect(run.id).toBeTruthy()
  })
})

// ===========================================================================
// Onboarding (US-4.12)
// ===========================================================================

describe('onboarding — state machine (US-4.12)', () => {
  it('a workspace with no state defaults to pending; complete/skip/reset transition', async () => {
    const a = api()
    // WS.secondary has no seeded onboarding state.
    const initial = await a.onboarding.get(WS.secondary)
    expect(initial.status).toBe('pending')

    const done = await a.onboarding.complete(WS.secondary, { tableId: 'tbl_x' })
    expect(done.status).toBe('completed')
    expect(done.createdTableId).toBe('tbl_x')

    const reset = await a.onboarding.reset(WS.secondary)
    expect(reset.status).toBe('pending')

    const skipped = await a.onboarding.skip(WS.secondary)
    expect(skipped.status).toBe('skipped')
  })

  it('the seeded demo workspace is already onboarded', async () => {
    const a = api()
    expect((await a.onboarding.get(WS.primary)).status).toBe('completed')
  })
})
