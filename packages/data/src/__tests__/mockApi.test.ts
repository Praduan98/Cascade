import { beforeEach, describe, expect, it } from 'vitest'
import type { FilterGroup } from '@cascade/core'
import { MockApi } from '../mockApi'
import { SEED_IDS } from '../seed'
import { ForbiddenError, NotFoundError } from '../errors'

const { T } = SEED_IDS

function api() {
  // Node has no localStorage → each instance starts from a fresh seed.
  return new MockApi({ latency: false, storageKey: 'test:cascade' })
}

describe('MockApi — seed + read', () => {
  let a: MockApi
  beforeEach(() => {
    a = api()
  })

  it('starts signed in as the owner of the primary workspace', async () => {
    const session = await a.auth.currentSession()
    expect(session?.user.email).toBe('aitools@insightstap.com')
    expect(session?.role).toBe('owner')
  })

  it('lists 60 seeded company records', async () => {
    const { total, rows } = await a.records.list(T.companies, { limit: 5 })
    expect(total).toBe(60)
    expect(rows).toHaveLength(5)
    expect(typeof rows[0]?.cells['col_co_company']?.value).toBe('string')
  })
})

describe('MockApi — filter + sort', () => {
  it('applies a filter and a descending numeric sort together', async () => {
    const a = api()
    const filters: FilterGroup = {
      conjunction: 'and',
      items: [{ columnId: 'col_co_verified', op: 'is', operand: 'opt_v_pending' }],
    }
    const { rows, total } = await a.records.list(T.companies, {
      filters,
      sorts: [{ columnId: 'col_co_employees', dir: 'desc' }],
    })

    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThan(60)

    // every returned row matches the filter
    for (const r of rows) {
      expect(r.cells['col_co_verified']?.value).toBe('opt_v_pending')
    }
    // employees strictly non-increasing
    const employees = rows.map((r) => r.cells['col_co_employees']?.value as number)
    for (let i = 1; i < employees.length; i++) {
      expect(employees[i - 1]!).toBeGreaterThanOrEqual(employees[i]!)
    }
  })
})

describe('MockApi — cell patch + conflict', () => {
  it('patches a cell and reflects the new value', async () => {
    const a = api()
    const { rows } = await a.records.list(T.companies, { limit: 1 })
    const row = rows[0]!
    const res = await a.cells.patch([
      { recordId: row.row.id, columnId: 'col_co_company', value: 'Renamed Co', expectedUpdatedAt: row.row.updatedAt },
    ])
    expect(res.conflicts).toHaveLength(0)
    expect(res.updated).toHaveLength(1)

    const after = await a.records.list(T.companies, { limit: 1 })
    expect(after.rows[0]?.cells['col_co_company']?.value).toBe('Renamed Co')
  })

  it('returns a conflict when expectedUpdatedAt is stale', async () => {
    const a = api()
    const { rows } = await a.records.list(T.companies, { limit: 1 })
    const row = rows[0]!
    await a.cells.patch([{ recordId: row.row.id, columnId: 'col_co_company', value: 'First' }])
    const res = await a.cells.patch([
      { recordId: row.row.id, columnId: 'col_co_company', value: 'Second', expectedUpdatedAt: row.row.updatedAt },
    ])
    expect(res.updated).toHaveLength(0)
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]?.currentValue).toBe('First')
  })

  it('rejects invalid input with a validation error', async () => {
    const a = api()
    const { rows } = await a.records.list(T.companies, { limit: 1 })
    const row = rows[0]!
    await expect(
      a.cells.patch([{ recordId: row.row.id, columnId: 'col_co_email', value: 'not-an-email' }]),
    ).rejects.toThrow()
  })
})

describe('MockApi — role guards', () => {
  it('blocks a viewer from writing but allows reading', async () => {
    const a = api()
    await a.auth.switchUser(SEED_IDS.U.viewer)

    // read is allowed
    const { total } = await a.records.list(T.companies, { limit: 1 })
    expect(total).toBe(60)

    // write is blocked
    const { rows } = await a.records.list(T.companies, { limit: 1 })
    let error: unknown
    try {
      await a.cells.patch([{ recordId: rows[0]!.row.id, columnId: 'col_co_company', value: 'nope' }])
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ForbiddenError)
  })

  it('enforces workspace isolation (viewer cannot see the second workspace table)', async () => {
    const a = api()
    await a.auth.switchUser(SEED_IDS.U.viewer)
    let error: unknown
    try {
      await a.records.list(T.accounts)
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(NotFoundError)
  })

  it('blocks members from viewing the audit log', async () => {
    const a = api()
    await a.auth.switchUser(SEED_IDS.U.member)
    await expect(a.audit.list(SEED_IDS.WS.primary)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('MockApi — audited actions', () => {
  it('writes an audit entry when a table is created', async () => {
    const a = api()
    const table = await a.tables.create(SEED_IDS.WS.primary, { name: 'Prospects' })
    const entries = await a.audit.list(SEED_IDS.WS.primary)
    const created = entries.find((e) => e.action === 'table.create' && e.targetId === table.id)
    expect(created).toBeTruthy()
    expect(created?.actorName).toBe('Aarav Shah')
  })
})

describe('MockApi — retype coercion', () => {
  it('retypes a number column to text without data loss', async () => {
    const a = api()
    const { column, lost } = await a.columns.retype('col_co_employees', 'text')
    expect(column.type).toBe('text')
    expect(lost).toBe(0)
    const { rows } = await a.records.list(T.companies, { limit: 1 })
    expect(typeof rows[0]?.cells['col_co_employees']?.value).toBe('string')
  })
})

describe('generateRows perf helper', () => {
  it('synthesises many valid rows quickly', async () => {
    const a = api()
    const count = a.loadPerfRows(T.companies, 5000)
    expect(count).toBe(60 + 5000)
    const { total } = await a.records.list(T.companies, { limit: 1 })
    expect(total).toBe(5060)
  })
})
