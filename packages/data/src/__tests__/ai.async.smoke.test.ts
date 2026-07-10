import { describe, expect, it } from 'vitest'
import type { RunScope } from '@cascade/core'
import { readAi } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'

const { T, WS } = SEED_IDS
const AI_COL = 'col_co_pitch'

// Exercises the REAL scheduling path the app uses (setTimeout, not sync fn()),
// including staggered queueing + deterministic latency, then drains via whenIdle.
describe('ai — async scheduling (app path)', () => {
  it('drives selected rows to terminal states with real timers', async () => {
    const a = new MockApi({ latency: false, storageKey: 'test:ai:async', enrichment: { sync: false } })
    const rows = ['rec_co_020', 'rec_co_021', 'rec_co_022']
    const scope: RunScope = { mode: 'selected', recordIds: rows, columnIds: [AI_COL] }
    const before = (await a.credits.balance(WS.primary)).balance
    await a.ai.run(T.companies, scope, { forceFresh: true })
    await a.__drainAi()
    const { rows: listed } = await a.records.list(T.companies)
    for (const rid of rows) {
      const meta = readAi(listed.find((r) => r.row.id === rid)?.cells[AI_COL]?.meta)
      expect(meta).toBeTruthy()
      expect(['success', 'empty', 'failed', 'cached']).toContain(meta!.status)
    }
    // Balance moved by exactly what the run consumed, never negative.
    const run = (await a.ai.runs.list(WS.primary, { tableId: T.companies, limit: 1 }))[0]
    expect((await a.credits.balance(WS.primary)).balance).toBe(before - (run?.creditsConsumed ?? 0))
  }, 10000)
})
