// Pure unit tests for the operation-column cell factories (ai / agent / http /
// formula). Each takes a Column + a persisted Cell and drives the six-state
// status machine off the cell's `meta.*` slot — surfacing provenance (agent
// source counts, HTTP status codes, formula errors) onto `cell.data`. All
// canvas-free, so they run under jsdom without the grid.

import { describe, expect, it } from 'vitest'
import { makeAgentCell, makeAiCell, makeFormulaCell, makeHttpCell } from '@cascade/grid'
import type {
  AgentCellMeta,
  AiCellMeta,
  Cell,
  Column,
  ColumnType,
  FormulaCellMeta,
  HttpCellMeta,
} from '@cascade/core'

function col(type: ColumnType): Column {
  return { id: `c-${type}`, tableId: 't1', name: type, type, config: { type } as Column['config'], position: 0, isFrozen: false, width: 200 }
}

function cell(columnId: string, value: Cell['value'], meta: Cell['meta']): Cell {
  return { recordId: 'r1', columnId, value, meta }
}

describe('makeAiCell', () => {
  const c = col('ai')
  it('renders a successful generation as its value, carrying provenance', () => {
    const ai: AiCellMeta = {
      status: 'success', modelKey: 'gpt-x', operation: null, runId: 'run1',
      credits: 1, fromCache: false, fetchedAt: '2026-01-01T00:00:00Z', valueSource: 'provider',
    }
    const out = makeAiCell(c, cell(c.id, 'A tidy pitch', { ai }))
    expect(out.data.kind).toBe('status')
    expect(out.data.status).toBe('success')
    expect(out.data.display).toBe('A tidy pitch')
    expect(out.data.muted).toBe(false)
    expect(out.data.ai?.modelKey).toBe('gpt-x')
    expect(out.allowOverlay).toBe(false)
  })

  it('surfaces the failure reason on a failed generation', () => {
    const ai: AiCellMeta = {
      status: 'failed', modelKey: null, operation: null, runId: 'run1', reason: 'rate limited',
      credits: 0, fromCache: false, fetchedAt: null, valueSource: 'provider',
    }
    const out = makeAiCell(c, cell(c.id, null, { ai }))
    expect(out.data.status).toBe('failed')
    expect(out.data.display).toBe('rate limited')
    expect(out.data.muted).toBe(true)
  })

  it('falls back to a default reason for an empty result', () => {
    const ai: AiCellMeta = {
      status: 'empty', modelKey: null, operation: null, runId: 'run1',
      credits: 0, fromCache: false, fetchedAt: null, valueSource: 'provider',
    }
    const out = makeAiCell(c, cell(c.id, null, { ai }))
    expect(out.data.status).toBe('empty')
    expect(out.data.display).toBe('no result')
  })

  it('renders an un-generated cell as a plain (long-text) value', () => {
    const out = makeAiCell(c, undefined)
    // no meta ⇒ passthrough to makeCell, which routes ai through the longText renderer
    expect(out.data.kind).toBe('longText')
    expect(out.data.display).toBe('—')
  })
})

describe('makeAgentCell', () => {
  it('surfaces the cited-source count on a successful research answer', () => {
    const c = col('agent')
    const agent: AgentCellMeta = {
      status: 'success', modelKey: 'gpt-x', runId: 'run1', steps: 4, pages: 3, sourceCount: 3,
      credits: 5, fromCache: false, fetchedAt: '2026-01-01T00:00:00Z', valueSource: 'provider',
    }
    const out = makeAgentCell(c, cell(c.id, 'Paris', { agent }))
    expect(out.data.status).toBe('success')
    expect(out.data.display).toBe('Paris')
    expect(out.data.agent?.sourceCount).toBe(3)
  })
})

describe('makeHttpCell', () => {
  const c = col('http')
  it('surfaces the status code and derives an HTTP error message on failure', () => {
    const http: HttpCellMeta = {
      status: 'failed', runId: 'run1', method: 'GET', statusCode: 404,
      credits: 0, fromCache: false, fetchedAt: null, valueSource: 'provider',
    }
    const out = makeHttpCell(c, cell(c.id, null, { http }))
    expect(out.data.status).toBe('failed')
    expect(out.data.display).toBe('HTTP 404')
    expect(out.data.http?.statusCode).toBe(404)
  })

  it('renders a 200 response as its extracted value', () => {
    const http: HttpCellMeta = {
      status: 'success', runId: 'run1', method: 'GET', statusCode: 200,
      credits: 1, fromCache: false, fetchedAt: '2026-01-01T00:00:00Z', valueSource: 'provider',
    }
    const out = makeHttpCell(c, cell(c.id, 'ok', { http }))
    expect(out.data.status).toBe('success')
    expect(out.data.display).toBe('ok')
    expect(out.data.http?.statusCode).toBe(200)
  })
})

describe('makeFormulaCell', () => {
  const c = col('formula')
  it('renders a formula error as a failed cell carrying the message', () => {
    const formula: FormulaCellMeta = { status: 'error', error: 'Unknown function FOO', computedAt: '2026-01-01T00:00:00Z' }
    const out = makeFormulaCell(c, cell(c.id, null, { formula }))
    expect(out.data.status).toBe('failed')
    expect(out.data.formulaError).toBe('Unknown function FOO')
    expect(out.data.display).toBe('Unknown function FOO')
    expect(out.allowOverlay).toBe(false)
  })

  it('renders a computed value as plain, non-editable text', () => {
    const formula: FormulaCellMeta = { status: 'ok', computedAt: '2026-01-01T00:00:00Z' }
    const out = makeFormulaCell(c, cell(c.id, 'Enterprise', { formula }))
    expect(out.data.display).toBe('Enterprise')
    // formulas are computed, never hand-edited
    expect(out.allowOverlay).toBe(false)
  })
})
