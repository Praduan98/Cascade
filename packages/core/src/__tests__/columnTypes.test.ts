import { describe, expect, it } from 'vitest'
import {
  coerceColumnValue,
  columnTypeRegistry,
  defaultConfigFor,
  getColumnType,
} from '../columnTypes'
import type { Column, DateConfig, MultiSelectConfig, SingleSelectConfig } from '../types'

function col(id: string, type: Column['type'], config: Column['config']): Column {
  return { id, tableId: 't', name: id, type, config, position: 0, isFrozen: false, width: 160 }
}

describe('date formatDisplay', () => {
  const cfg = (format: string): DateConfig => ({ type: 'date', format })
  const d = getColumnType('date')
  it('does not clobber month names containing token letters (Dec regression)', () => {
    expect(d.formatDisplay('2026-12-12', cfg('MMM D, YYYY'))).toBe('Dec 12, 2026')
    expect(d.formatDisplay('2026-12-05', cfg('MMMM D, YYYY'))).toBe('December 5, 2026')
  })
  it('formats other months and the default ISO correctly', () => {
    expect(d.formatDisplay('2024-01-01', cfg('MMM D, YYYY'))).toBe('Jan 1, 2024')
    expect(d.formatDisplay('2024-03-09', cfg('YYYY-MM-DD'))).toBe('2024-03-09')
  })
})

describe('validate — text-like', () => {
  it('text coerces to string and empties to null', () => {
    const t = getColumnType('text')
    expect(t.validate('hello', defaultConfigFor('text'))).toEqual({ ok: true, value: 'hello' })
    expect(t.validate('', defaultConfigFor('text'))).toEqual({ ok: true, value: null })
    expect(t.validate(null, defaultConfigFor('text'))).toEqual({ ok: true, value: null })
  })

  it('email lowercases and rejects bad shape', () => {
    const e = getColumnType('email')
    expect(e.validate('  ADA@Example.COM ', defaultConfigFor('email'))).toEqual({ ok: true, value: 'ada@example.com' })
    const bad = e.validate('not-an-email', defaultConfigFor('email'))
    expect(bad.ok).toBe(false)
  })

  it('url normalises and adds scheme', () => {
    const u = getColumnType('url')
    const r = u.validate('example.com/path', defaultConfigFor('url'))
    expect(r).toEqual({ ok: true, value: 'https://example.com/path' })
    expect(u.validate('nota domain', defaultConfigFor('url')).ok).toBe(false)
  })

  it('phone validates digit count', () => {
    const p = getColumnType('phone')
    expect(p.validate('+1 (415) 555-0123', defaultConfigFor('phone'))).toEqual({ ok: true, value: '+14155550123' })
    expect(p.validate('12', defaultConfigFor('phone')).ok).toBe(false)
  })
})

describe('validate — number / currency / boolean', () => {
  it('number rejects non-numeric, strips separators', () => {
    const n = getColumnType('number')
    expect(n.validate('1,234.5', defaultConfigFor('number'))).toEqual({ ok: true, value: 1234.5 })
    expect(n.validate('abc', defaultConfigFor('number')).ok).toBe(false)
    expect(n.validate('', defaultConfigFor('number'))).toEqual({ ok: true, value: null })
  })

  it('currency parses money strings', () => {
    const c = getColumnType('currency')
    expect(c.validate('$1,999.00', defaultConfigFor('currency'))).toEqual({ ok: true, value: 1999 })
    expect(c.formatDisplay(1999, defaultConfigFor('currency'))).toBe('$1,999.00')
  })

  it('boolean accepts yes/no/true/false', () => {
    const b = getColumnType('boolean')
    expect(b.validate('Yes', defaultConfigFor('boolean'))).toEqual({ ok: true, value: true })
    expect(b.validate('no', defaultConfigFor('boolean'))).toEqual({ ok: true, value: false })
    expect(b.validate('maybe', defaultConfigFor('boolean')).ok).toBe(false)
  })
})

describe('validate — date', () => {
  it('accepts ISO and normalises slashes', () => {
    const d = getColumnType('date')
    expect(d.validate('2026-07-09', defaultConfigFor('date'))).toEqual({ ok: true, value: '2026-07-09' })
    expect(d.validate('07/09/2026', defaultConfigFor('date'))).toEqual({ ok: true, value: '2026-07-09' })
    expect(d.validate('nope', defaultConfigFor('date')).ok).toBe(false)
    expect(d.validate('2026-13-40', defaultConfigFor('date')).ok).toBe(false)
  })

  it('formats per config', () => {
    const d = getColumnType('date')
    expect(d.formatDisplay('2026-07-09', { type: 'date', format: 'MMM D, YYYY' })).toBe('Jul 9, 2026')
  })
})

describe('validate — selects', () => {
  const single: SingleSelectConfig = {
    type: 'singleSelect',
    options: [
      { id: 'o_yes', label: 'Yes', color: '#38d08c' },
      { id: 'o_no', label: 'No', color: '#f2666b' },
    ],
  }
  const multi: MultiSelectConfig = {
    type: 'multiSelect',
    options: [
      { id: 'o_saas', label: 'SaaS', color: '#2fe6c8' },
      { id: 'o_fin', label: 'Fintech', color: '#4f9dff' },
    ],
  }

  it('single-select matches by id or label, rejects unknown', () => {
    const s = getColumnType('singleSelect')
    expect(s.validate('Yes', single)).toEqual({ ok: true, value: 'o_yes' })
    expect(s.validate('o_no', single)).toEqual({ ok: true, value: 'o_no' })
    expect(s.validate('Nope', single).ok).toBe(false)
    expect(s.validate('', single)).toEqual({ ok: true, value: null })
  })

  it('multi-select parses a delimited list and dedupes', () => {
    const m = getColumnType('multiSelect')
    expect(m.validate('SaaS, Fintech', multi)).toEqual({ ok: true, value: ['o_saas', 'o_fin'] })
    expect(m.validate(['o_saas', 'o_saas'], multi)).toEqual({ ok: true, value: ['o_saas'] })
    expect(m.validate('SaaS; Unknown', multi).ok).toBe(false)
    expect(m.formatDisplay(['o_saas', 'o_fin'], multi)).toBe('SaaS, Fintech')
  })
})

describe('coerceColumnValue', () => {
  const single: SingleSelectConfig = {
    type: 'singleSelect',
    options: [{ id: 'o_saas', label: 'SaaS', color: '#2fe6c8' }],
  }

  it('number → text keeps the number, non-lossy', () => {
    const from = col('a', 'number', defaultConfigFor('number'))
    const to = col('a', 'text', defaultConfigFor('text'))
    expect(coerceColumnValue(from, to, 42)).toEqual({ value: '42', lossy: false })
  })

  it('text → number parses when possible, flags loss otherwise', () => {
    const from = col('a', 'text', defaultConfigFor('text'))
    const to = col('a', 'number', defaultConfigFor('number'))
    expect(coerceColumnValue(from, to, '3.14')).toEqual({ value: 3.14, lossy: false })
    const lossy = coerceColumnValue(from, to, 'hello')
    expect(lossy.value).toBeNull()
    expect(lossy.lossy).toBe(true)
  })

  it('single-select → text preserves the label', () => {
    const from = col('a', 'singleSelect', single)
    const to = col('a', 'text', defaultConfigFor('text'))
    expect(coerceColumnValue(from, to, 'o_saas')).toEqual({ value: 'SaaS', lossy: false })
  })

  it('text → single-select matches an option label', () => {
    const from = col('a', 'text', defaultConfigFor('text'))
    const to = col('a', 'singleSelect', single)
    expect(coerceColumnValue(from, to, 'SaaS')).toEqual({ value: 'o_saas', lossy: false })
  })

  it('empty stays empty', () => {
    const from = col('a', 'text', defaultConfigFor('text'))
    const to = col('a', 'multiSelect', defaultConfigFor('multiSelect'))
    expect(coerceColumnValue(from, to, null)).toEqual({ value: [], lossy: false })
  })
})

describe('registry shape', () => {
  it('every type has a badge and default config of the right discriminant', () => {
    for (const [type, def] of Object.entries(columnTypeRegistry)) {
      expect(def.typeBadge.length).toBeGreaterThan(0)
      expect(def.defaultConfig().type).toBe(type)
      expect(def.filterOperators.length).toBeGreaterThan(0)
    }
  })
})
