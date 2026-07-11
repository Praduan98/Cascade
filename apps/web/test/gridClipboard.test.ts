// Interaction test for the grid's copy/paste planning layer (planPaste,
// cellsToStringGrid) — the pure helpers behind Cmd/Ctrl+C / +V. planPaste maps
// the clipboard's TSV onto a target range, coerces + validates every value
// against the TARGET column type, and emits forward + inverse patches so a
// paste lands as a single undoable command. We drive it with the real seed
// schema so validation runs against production column configs (a hand-rolled
// fixture would let a wrong config shape pass unnoticed).

import { beforeEach, describe, expect, it } from 'vitest'
import { MockApi, SEED_IDS } from '@cascade/data'
import { cellsToStringGrid, planPaste } from '@cascade/grid'
import type { Column, RowWithCells } from '@cascade/core'

const { T } = SEED_IDS
const ROW_COUNT = 60 // seeded company records

let columns: Column[]
let rows: RowWithCells[]
/** Windowed-cache stand-in: serves the first loaded page, misses everything else. */
let getRow: (row: number) => RowWithCells | undefined

// The number column ("Employees") is the cleanest paste target — numeric
// validation is unambiguous, so type-match vs mismatch is easy to assert.
let numCol: Column
let numX: number

beforeEach(async () => {
  const api = new MockApi({ latency: false, storageKey: 'test:clip' })
  columns = (await api.columns.list(T.companies)).slice().sort((a, b) => a.position - b.position)
  rows = (await api.records.list(T.companies, { limit: 5 })).rows
  getRow = (row) => rows[row]
  numCol = columns.find((c) => c.type === 'number')!
  numX = columns.indexOf(numCol)
})

describe('cellsToStringGrid', () => {
  it('extracts each cell\'s copyData into a 2-D grid, blanking missing values', () => {
    const cells = [
      [{ copyData: 'Acme' }, { copyData: 'https://acme.com' }],
      [{ copyData: 'Globex' }, { copyData: undefined }],
    ] as unknown as Parameters<typeof cellsToStringGrid>[0]

    expect(cellsToStringGrid(cells)).toEqual([
      ['Acme', 'https://acme.com'],
      ['Globex', ''],
    ])
  })
})

describe('planPaste — single-cell fill', () => {
  it('fills the whole target range from a 1×1 clipboard (spreadsheet convention)', () => {
    const plan = planPaste('250', { x: numX, y: 0, width: 1, height: 3 }, columns, ROW_COUNT, getRow)

    expect(plan.applied).toBe(3)
    expect(plan.skipped).toBe(0)
    expect(plan.forward).toHaveLength(3)
    // every filled cell carries the same coerced numeric value
    expect(plan.forward.every((e) => e.value === 250)).toBe(true)
    // forward patches carry the last-write-wins guard
    expect(plan.forward.every((e) => typeof e.expectedUpdatedAt === 'string')).toBe(true)
    expect(plan.forward.map((e) => e.recordId)).toEqual([rows[0]!.row.id, rows[1]!.row.id, rows[2]!.row.id])
  })

  it('captures each cell\'s previous value as the inverse patch (for undo)', () => {
    const plan = planPaste('999', { x: numX, y: 0, width: 1, height: 2 }, columns, ROW_COUNT, getRow)

    expect(plan.inverse).toHaveLength(plan.forward.length)
    // inverse restores the pre-paste values, keyed to the same cells
    expect(plan.inverse[0]!.value).toBe(rows[0]!.cells[numCol.id]!.value)
    expect(plan.inverse[1]!.value).toBe(rows[1]!.cells[numCol.id]!.value)
    expect(plan.inverse[0]!.recordId).toBe(rows[0]!.row.id)
    // the inverse is a plain restore — no optimistic-concurrency guard
    expect(plan.inverse[0]!.expectedUpdatedAt).toBeUndefined()
  })
})

describe('planPaste — multi-cell block', () => {
  it('maps a multi-row clipboard row-by-row from the range top-left', () => {
    const plan = planPaste('10\n20\n30', { x: numX, y: 0, width: 1, height: 1 }, columns, ROW_COUNT, getRow)

    expect(plan.applied).toBe(3)
    expect(plan.skipped).toBe(0)
    expect(plan.forward.map((e) => e.value)).toEqual([10, 20, 30])
  })
})

describe('planPaste — cells that cannot be written are skipped, not guessed', () => {
  it('skips a target column that is out of bounds', () => {
    const plan = planPaste('x', { x: columns.length, y: 0, width: 1, height: 1 }, columns, ROW_COUNT, getRow)

    expect(plan.applied).toBe(0)
    expect(plan.skipped).toBe(1)
    expect(plan.forward).toHaveLength(0)
  })

  it('skips a value that fails the target column\'s type validation', () => {
    const plan = planPaste('not-a-number', { x: numX, y: 0, width: 1, height: 1 }, columns, ROW_COUNT, getRow)

    expect(plan.applied).toBe(0)
    expect(plan.skipped).toBe(1)
  })

  it('skips a target row that is not in the windowed cache', () => {
    // Row 10 is within the table (rowCount 60) but not in the 5-row cache.
    const plan = planPaste('42', { x: numX, y: 10, width: 1, height: 1 }, columns, ROW_COUNT, getRow)

    expect(plan.applied).toBe(0)
    expect(plan.skipped).toBe(1)
  })

  it('stops at the last row rather than writing past the row count', () => {
    const lastRowCount = 2 // pretend the table only has rows 0 and 1 loaded/counted
    const twoRowGetRow = (r: number) => rows[r]
    const plan = planPaste('1\n2\n3', { x: numX, y: 1, width: 1, height: 1 }, columns, lastRowCount, twoRowGetRow)

    // y=1 is the last row; rows at y=2 and y=3 are beyond rowCount → loop breaks
    expect(plan.applied).toBe(1)
    expect(plan.forward[0]!.recordId).toBe(rows[1]!.row.id)
  })
})
