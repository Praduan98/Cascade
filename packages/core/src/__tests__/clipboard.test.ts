import { describe, expect, it } from 'vitest'
import { parseClipboard, toClipboard, toCsv } from '../clipboard'

describe('parseClipboard', () => {
  it('parses TSV from a spreadsheet copy', () => {
    const text = 'Company\tEmployees\nAcme\t120\nGlobex\t45'
    expect(parseClipboard(text)).toEqual([
      ['Company', 'Employees'],
      ['Acme', '120'],
      ['Globex', '45'],
    ])
  })

  it('parses quoted CSV with embedded commas', () => {
    const text = 'name,note\nAcme,"Big, important account"\nGlobex,ok'
    expect(parseClipboard(text)).toEqual([
      ['name', 'note'],
      ['Acme', 'Big, important account'],
      ['Globex', 'ok'],
    ])
  })

  it('handles quoted multi-line CSV fields', () => {
    const text = 'a,b\n"line one\nline two",second'
    expect(parseClipboard(text)).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'second'],
    ])
  })

  it('handles escaped double-quotes', () => {
    const text = 'quote\n"He said ""hi"""'
    expect(parseClipboard(text)).toEqual([['quote'], ['He said "hi"']])
  })

  it('handles CRLF line endings and trailing newline', () => {
    const text = 'a\tb\r\n1\t2\r\n'
    expect(parseClipboard(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('returns empty for empty input', () => {
    expect(parseClipboard('')).toEqual([])
  })
})

describe('round-trip', () => {
  it('toClipboard escapes cells so parseClipboard restores them', () => {
    const grid = [
      ['plain', 'has\ttab'],
      ['has\nnewline', 'has "quote"'],
    ]
    const restored = parseClipboard(toClipboard(grid))
    expect(restored).toEqual(grid)
  })

  it('toCsv quotes commas and quotes', () => {
    const grid = [['a,b', 'c"d']]
    expect(toCsv(grid)).toBe('"a,b","c""d"')
  })
})
