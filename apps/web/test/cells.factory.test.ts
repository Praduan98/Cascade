// Pure unit tests for the grid cell factories. These build a Cascade custom
// cell from a (column, value) pair and are canvas-free — they only shape the
// `cell.data` a renderer later paints — so they run happily under jsdom without
// ever mounting the grid.

import { describe, expect, it } from 'vitest'
import { makeCell } from '@cascade/grid'
import type {
  Column,
  ColumnConfig,
  ColumnType,
  MultiSelectConfig,
  SingleSelectConfig,
} from '@cascade/core'

function col(type: ColumnType, config: ColumnConfig): Column {
  return { id: `c-${type}`, tableId: 't1', name: type, type, config, position: 0, isFrozen: false, width: 160 }
}

const EMDASH = '—'

describe('makeCell — plain typed values', () => {
  it('renders a text value verbatim, not muted', () => {
    const cell = makeCell(col('text', { type: 'text' }), 'Acme Inc')
    expect(cell.data.kind).toBe('text')
    expect(cell.data.display).toBe('Acme Inc')
    expect(cell.data.muted).toBe(false)
    expect(cell.copyData).toBe('Acme Inc')
    expect(cell.allowOverlay).toBe(true)
  })

  it('renders an empty text value as an em-dash, muted', () => {
    const cell = makeCell(col('text', { type: 'text' }), null)
    expect(cell.data.display).toBe(EMDASH)
    expect(cell.data.muted).toBe(true)
  })

  it('flags number cells as numeric', () => {
    const cell = makeCell(col('number', { type: 'number', precision: 0 }), 42)
    expect(cell.data.kind).toBe('number')
    expect(cell.data.numeric).toBe(true)
    expect(cell.data.muted).toBe(false)
    expect(cell.data.display).not.toBe('')
  })

  it('maps booleans to Yes/No + a checked flag', () => {
    const yes = makeCell(col('boolean', { type: 'boolean' }), true)
    expect(yes.data.kind).toBe('boolean')
    expect(yes.data.display).toBe('Yes')
    expect(yes.data.checked).toBe(true)
    // boolean cells are toggled in-grid, never opened in an overlay
    expect(yes.allowOverlay).toBe(false)

    const blank = makeCell(col('boolean', { type: 'boolean' }), null)
    expect(blank.data.display).toBe('')
    expect(blank.data.checked).toBe(null)
  })

  it('resolves a single-select value to one coloured chip', () => {
    const config: SingleSelectConfig = {
      type: 'singleSelect',
      options: [
        { id: 'lead', label: 'Lead', color: '#3b82f6' },
        { id: 'won', label: 'Won', color: '#22c55e' },
      ],
    }
    const cell = makeCell(col('singleSelect', config), 'won')
    expect(cell.data.chips?.length).toBe(1)
    expect(cell.data.chips?.[0]?.label).toBe('Won')
    expect(cell.data.chips?.[0]?.color).toBe('#22c55e')
    expect(cell.data.display).toBe('Won')
    expect(cell.data.muted).toBe(false)
  })

  it('mutes a single-select value that matches no option', () => {
    const config: SingleSelectConfig = { type: 'singleSelect', options: [{ id: 'lead', label: 'Lead', color: '#3b82f6' }] }
    const cell = makeCell(col('singleSelect', config), 'ghost')
    expect(cell.data.chips?.length).toBe(0)
    expect(cell.data.display).toBe(EMDASH)
    expect(cell.data.muted).toBe(true)
  })

  it('resolves multi-select values to a chip per matched id', () => {
    const config: MultiSelectConfig = {
      type: 'multiSelect',
      options: [
        { id: 'a', label: 'Alpha', color: '#111' },
        { id: 'b', label: 'Bravo', color: '#222' },
        { id: 'c', label: 'Charlie', color: '#333' },
      ],
    }
    const cell = makeCell(col('multiSelect', config), ['a', 'c'])
    expect(cell.data.chips?.length).toBe(2)
    expect(cell.data.display).toBe('Alpha, Charlie')
    expect(cell.data.muted).toBe(false)
  })

  it('marks a populated url as a link and an empty one as not', () => {
    const linked = makeCell(col('url', { type: 'url' }), 'https://acme.com')
    expect(linked.data.link).toBe(true)
    expect(linked.data.muted).toBe(false)

    const empty = makeCell(col('url', { type: 'url' }), null)
    expect(empty.data.link).toBe(false)
    expect(empty.data.display).toBe(EMDASH)
    expect(empty.data.muted).toBe(true)
  })
})
