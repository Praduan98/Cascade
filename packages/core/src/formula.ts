// @cascade/core — a safe formula evaluator (Phase 3, US-3.6). No `eval`, no
// arbitrary code: a small tokenizer → Pratt parser → tree-walking evaluator over
// a fixed operator + function set. Formulas reference other columns via
// {{Column Name}}, support if/then/else and string/number/date/boolean ops, and
// surface errors instead of throwing. Framework-agnostic.

import type { CellValue } from './types'

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokKind = 'num' | 'str' | 'bool' | 'ref' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof'
interface Tok {
  kind: TokKind
  value: string
  pos: number
}

const OP_CHARS = new Set(['+', '-', '*', '/', '<', '>', '=', '!', '&', '|'])

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    // {{ Column Name }} reference
    if (c === '{' && src[i + 1] === '{') {
      const end = src.indexOf('}}', i + 2)
      if (end === -1) throw new FormulaError('Unclosed {{reference}}')
      toks.push({ kind: 'ref', value: src.slice(i + 2, end).trim(), pos: i })
      i = end + 2
      continue
    }
    // string literal
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < n && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2 } else { s += src[j]; j++ }
      }
      if (j >= n) throw new FormulaError('Unterminated string')
      toks.push({ kind: 'str', value: s, pos: i })
      i = j + 1
      continue
    }
    // number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9.]/.test(src[j]!)) j++
      toks.push({ kind: 'num', value: src.slice(i, j), pos: i })
      i = j
      continue
    }
    // identifier / keyword / function
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++
      const word = src.slice(i, j)
      const lower = word.toLowerCase()
      if (lower === 'true' || lower === 'false') toks.push({ kind: 'bool', value: lower, pos: i })
      else if (lower === 'and') toks.push({ kind: 'op', value: '&&', pos: i })
      else if (lower === 'or') toks.push({ kind: 'op', value: '||', pos: i })
      else if (lower === 'not') toks.push({ kind: 'op', value: '!', pos: i })
      else toks.push({ kind: 'ident', value: word, pos: i })
      i = j
      continue
    }
    if (c === '(') { toks.push({ kind: 'lparen', value: c, pos: i }); i++; continue }
    if (c === ')') { toks.push({ kind: 'rparen', value: c, pos: i }); i++; continue }
    if (c === ',') { toks.push({ kind: 'comma', value: c, pos: i }); i++; continue }
    // operators (multi-char first)
    if (OP_CHARS.has(c)) {
      const two = src.slice(i, i + 2)
      if (two === '<=' || two === '>=' || two === '!=' || two === '<>' || two === '==' || two === '&&' || two === '||') {
        toks.push({ kind: 'op', value: two === '<>' || two === '==' ? (two === '<>' ? '!=' : '=') : two, pos: i })
        i += 2
        continue
      }
      toks.push({ kind: 'op', value: c, pos: i })
      i++
      continue
    }
    throw new FormulaError(`Unexpected character "${c}"`)
  }
  toks.push({ kind: 'eof', value: '', pos: n })
  return toks
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; name: string }
  | { t: 'unary'; op: string; a: Node }
  | { t: 'binary'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }

class FormulaError extends Error {}

// Binary operator precedence (higher binds tighter).
const PREC: Record<string, number> = {
  '||': 1, '&&': 2,
  '=': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '&': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6,
}

class Parser {
  private p = 0
  constructor(private toks: Tok[]) {}
  private peek(): Tok { return this.toks[this.p]! }
  private next(): Tok { return this.toks[this.p++]! }
  private expect(kind: TokKind): Tok {
    const t = this.next()
    if (t.kind !== kind) throw new FormulaError(`Expected ${kind}`)
    return t
  }

  parse(): Node {
    const node = this.parseExpr(0)
    if (this.peek().kind !== 'eof') throw new FormulaError('Unexpected trailing input')
    return node
  }

  private parseExpr(minPrec: number): Node {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'op' || !(t.value in PREC)) break
      const prec = PREC[t.value]!
      if (prec < minPrec) break
      this.next()
      const right = this.parseExpr(prec + 1)
      left = { t: 'binary', op: t.value, a: left, b: right }
    }
    return left
  }

  private parseUnary(): Node {
    const t = this.peek()
    if (t.kind === 'op' && (t.value === '-' || t.value === '!' || t.value === '+')) {
      this.next()
      return { t: 'unary', op: t.value, a: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Node {
    const t = this.next()
    switch (t.kind) {
      case 'num': return { t: 'num', v: Number(t.value) }
      case 'str': return { t: 'str', v: t.value }
      case 'bool': return { t: 'bool', v: t.value === 'true' }
      case 'ref': return { t: 'ref', name: t.value }
      case 'lparen': {
        const e = this.parseExpr(0)
        this.expect('rparen')
        return e
      }
      case 'ident': {
        // function call
        if (this.peek().kind === 'lparen') {
          this.next()
          const args: Node[] = []
          if (this.peek().kind !== 'rparen') {
            args.push(this.parseExpr(0))
            while (this.peek().kind === 'comma') { this.next(); args.push(this.parseExpr(0)) }
          }
          this.expect('rparen')
          return { t: 'call', name: t.value.toUpperCase(), args }
        }
        throw new FormulaError(`Unknown name "${t.value}" (use {{Column}} for column references)`)
      }
      default:
        throw new FormulaError('Unexpected token')
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type V = string | number | boolean | null

function toNum(v: V): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v == null || v === '') return 0
  const n = Number(v)
  if (Number.isNaN(n)) throw new FormulaError(`"${v}" is not a number`)
  return n
}
function toStr(v: V): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}
function toBool(v: V): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v == null || v === '') return false
  return String(v).toLowerCase() === 'true'
}
function equalish(a: V, b: V): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a), nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb
  }
  return toStr(a) === toStr(b)
}

const FUNCS: Record<string, (args: V[]) => V> = {
  IF: (a) => (toBool(a[0] ?? null) ? a[1] ?? null : a[2] ?? null),
  CONCAT: (a) => a.map(toStr).join(''),
  UPPER: (a) => toStr(a[0] ?? null).toUpperCase(),
  LOWER: (a) => toStr(a[0] ?? null).toLowerCase(),
  TRIM: (a) => toStr(a[0] ?? null).trim(),
  LEN: (a) => toStr(a[0] ?? null).length,
  LEFT: (a) => toStr(a[0] ?? null).slice(0, toNum(a[1] ?? 0)),
  RIGHT: (a) => { const s = toStr(a[0] ?? null), n = toNum(a[1] ?? 0); return n <= 0 ? '' : s.slice(-n) },
  CONTAINS: (a) => toStr(a[0] ?? null).toLowerCase().includes(toStr(a[1] ?? null).toLowerCase()),
  ROUND: (a) => { const d = toNum(a[1] ?? 0); const f = 10 ** d; return Math.round(toNum(a[0] ?? 0) * f) / f },
  ABS: (a) => Math.abs(toNum(a[0] ?? 0)),
  MIN: (a) => Math.min(...a.map(toNum)),
  MAX: (a) => Math.max(...a.map(toNum)),
  COALESCE: (a) => { for (const v of a) if (v != null && v !== '') return v; return null },
  ISEMPTY: (a) => { const v = a[0] ?? null; return v == null || v === '' || (Array.isArray(v) && v.length === 0) },
  YEAR: (a) => dpart(a[0] ?? null, 0),
  MONTH: (a) => dpart(a[0] ?? null, 1),
  DAY: (a) => dpart(a[0] ?? null, 2),
}

function dpart(v: V, idx: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(toStr(v))
  if (!m) throw new FormulaError('Expected a YYYY-MM-DD date')
  return Number(m[idx + 1])
}

function evalNode(node: Node, resolve: (name: string) => CellValue | undefined): V {
  switch (node.t) {
    case 'num': return node.v
    case 'str': return node.v
    case 'bool': return node.v
    case 'ref': {
      const v = resolve(node.name)
      if (v === undefined) throw new FormulaError(`Unknown column {{${node.name}}}`)
      if (Array.isArray(v)) return v.join(', ')
      return v
    }
    case 'unary': {
      const a = evalNode(node.a, resolve)
      if (node.op === '-') return -toNum(a)
      if (node.op === '+') return toNum(a)
      return !toBool(a)
    }
    case 'call': {
      const fn = FUNCS[node.name]
      if (!fn) throw new FormulaError(`Unknown function ${node.name}()`)
      return fn(node.args.map((x) => evalNode(x, resolve)))
    }
    case 'binary': {
      const { op } = node
      if (op === '&&') return toBool(evalNode(node.a, resolve)) && toBool(evalNode(node.b, resolve))
      if (op === '||') return toBool(evalNode(node.a, resolve)) || toBool(evalNode(node.b, resolve))
      const a = evalNode(node.a, resolve)
      const b = evalNode(node.b, resolve)
      switch (op) {
        case '&': return toStr(a) + toStr(b)
        case '+': return toNum(a) + toNum(b)
        case '-': return toNum(a) - toNum(b)
        case '*': return toNum(a) * toNum(b)
        case '/': { const d = toNum(b); if (d === 0) throw new FormulaError('Division by zero'); return toNum(a) / d }
        case '=': return equalish(a, b)
        case '!=': return !equalish(a, b)
        case '<': return toNum(a) < toNum(b)
        case '>': return toNum(a) > toNum(b)
        case '<=': return toNum(a) <= toNum(b)
        case '>=': return toNum(a) >= toNum(b)
      }
      throw new FormulaError(`Unknown operator ${op}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormulaResult {
  value: CellValue
  error?: string
}

/** Distinct {{Column}} names referenced by a formula (drives recompute-on-change). */
export function extractFormulaRefs(src: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const name = (m[1] ?? '').trim()
    if (name && !seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}

/** Validate a formula parses (used before persisting); returns an error string or null. */
export function validateFormula(src: string): string | null {
  try {
    new Parser(tokenize(src)).parse()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula'
  }
}

/** Evaluate a formula against a row. Never throws — errors come back on `.error`. */
export function evaluateFormula(src: string, resolve: (name: string) => CellValue | undefined): FormulaResult {
  try {
    const ast = new Parser(tokenize(src)).parse()
    const v = evalNode(ast, resolve)
    if (typeof v === 'number' && !Number.isFinite(v)) return { value: null, error: 'Not a finite number' }
    return { value: v as CellValue }
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'Formula error' }
  }
}
