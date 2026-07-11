// THE REGISTRY — the single source of truth for the 11 column types.
//
// Each entry knows how to: validate raw input, coerce a value from another
// type, render a display string, round-trip through CSV, and expose the set of
// filter operators appropriate to the type. Everything else (grid editors, the
// mock API, the filter builder, CSV import/export) reads from here so behaviour
// stays consistent across the app.

import type {
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  CurrencyConfig,
  DateConfig,
  MultiSelectConfig,
  NumberConfig,
  SelectOption,
  SingleSelectConfig,
} from './types'

// ---------------------------------------------------------------------------
// Result + operator contracts
// ---------------------------------------------------------------------------

export interface ValidateOk {
  ok: true
  value: CellValue
}
export interface ValidateErr {
  ok: false
  error: string
}
export type ValidateResult = ValidateOk | ValidateErr

const ok = (value: CellValue): ValidateOk => ({ ok: true, value })
const err = (error: string): ValidateErr => ({ ok: false, error })

export interface FilterOperator {
  /** Stable id, e.g. "contains", "gte", "isEmpty". */
  id: string
  label: string
  /** True when the operator takes no operand (e.g. "is empty"). */
  unary?: boolean
  /** Evaluate the condition for a single cell value. */
  apply(value: CellValue, operand: unknown): boolean
}

export interface ColumnTypeDef {
  type: ColumnType
  label: string
  /** Short badge shown in headers, e.g. "Aa", "#", "URL". */
  typeBadge: string
  defaultConfig(): ColumnConfig
  isEmpty(value: CellValue): boolean
  validate(raw: unknown, config: ColumnConfig): ValidateResult
  /**
   * Convert a value coming from `fromType` into this type. `config` is THIS
   * type's (target) config. `toType` is this entry's own type (kept for a
   * literal, self-describing signature). For high-fidelity retyping that needs
   * the source config (e.g. select labels), prefer `coerceColumnValue`.
   */
  coerce(value: CellValue, fromType: ColumnType, toType: ColumnType, config: ColumnConfig): CellValue
  formatDisplay(value: CellValue, config: ColumnConfig): string
  toCsv(value: CellValue, config: ColumnConfig): string
  fromCsv(str: string, config: ColumnConfig): CellValue
  filterOperators: FilterOperator[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function asString(value: CellValue): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function emptyString(value: CellValue): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

/** Multi-select CSV / display delimiter (documented, consistent). */
const MULTI_DELIM = ', '

function findOption(options: SelectOption[], token: string): SelectOption | undefined {
  const t = token.trim()
  if (t === '') return undefined
  const lower = t.toLowerCase()
  return (
    options.find((o) => o.id === t) ??
    options.find((o) => o.label.toLowerCase() === lower)
  )
}

// ---------------------------------------------------------------------------
// Filter operator sets
// ---------------------------------------------------------------------------

function textOperators(): FilterOperator[] {
  const hay = (v: CellValue) => asString(v).toLowerCase()
  const need = (o: unknown) => String(o ?? '').toLowerCase()
  return [
    { id: 'contains', label: 'contains', apply: (v, o) => hay(v).includes(need(o)) },
    { id: 'notContains', label: 'does not contain', apply: (v, o) => !hay(v).includes(need(o)) },
    { id: 'equals', label: 'is', apply: (v, o) => hay(v) === need(o) },
    { id: 'notEquals', label: 'is not', apply: (v, o) => hay(v) !== need(o) },
    { id: 'startsWith', label: 'starts with', apply: (v, o) => hay(v).startsWith(need(o)) },
    { id: 'endsWith', label: 'ends with', apply: (v, o) => hay(v).endsWith(need(o)) },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => emptyString(v) },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => !emptyString(v) },
  ]
}

function numberOperators(): FilterOperator[] {
  const num = (v: CellValue): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)
  const opnum = (o: unknown): number | null => {
    const n = typeof o === 'number' ? o : Number(o)
    return Number.isNaN(n) ? null : n
  }
  const pair = (o: unknown): [number, number] | null => {
    if (!Array.isArray(o) || o.length < 2) return null
    const a = opnum(o[0])
    const b = opnum(o[1])
    return a == null || b == null ? null : [Math.min(a, b), Math.max(a, b)]
  }
  return [
    { id: 'equals', label: '=', apply: (v, o) => num(v) != null && num(v) === opnum(o) },
    { id: 'notEquals', label: '≠', apply: (v, o) => num(v) == null || num(v) !== opnum(o) },
    { id: 'gt', label: '>', apply: (v, o) => { const a = num(v), b = opnum(o); return a != null && b != null && a > b } },
    { id: 'gte', label: '≥', apply: (v, o) => { const a = num(v), b = opnum(o); return a != null && b != null && a >= b } },
    { id: 'lt', label: '<', apply: (v, o) => { const a = num(v), b = opnum(o); return a != null && b != null && a < b } },
    { id: 'lte', label: '≤', apply: (v, o) => { const a = num(v), b = opnum(o); return a != null && b != null && a <= b } },
    { id: 'between', label: 'is between', apply: (v, o) => { const a = num(v), p = pair(o); return a != null && p != null && a >= p[0] && a <= p[1] } },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => v == null },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => v != null },
  ]
}

function booleanOperators(): FilterOperator[] {
  const truthy = (o: unknown) => o === true || o === 'true' || o === 1 || o === '1'
  return [
    { id: 'is', label: 'is', apply: (v, o) => v === truthy(o) },
    { id: 'isChecked', label: 'is checked', unary: true, apply: (v) => v === true },
    { id: 'isUnchecked', label: 'is unchecked', unary: true, apply: (v) => v === false },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => v == null },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => v != null },
  ]
}

function dateOperators(): FilterOperator[] {
  const s = (v: CellValue): string | null => (typeof v === 'string' && v !== '' ? v : null)
  const os = (o: unknown): string | null => (typeof o === 'string' && o !== '' ? o : null)
  const pair = (o: unknown): [string, string] | null => {
    if (!Array.isArray(o) || o.length < 2) return null
    const a = os(o[0])
    const b = os(o[1])
    if (a == null || b == null) return null
    return a <= b ? [a, b] : [b, a]
  }
  return [
    { id: 'is', label: 'is', apply: (v, o) => s(v) != null && s(v) === os(o) },
    { id: 'before', label: 'is before', apply: (v, o) => { const a = s(v), b = os(o); return a != null && b != null && a < b } },
    { id: 'after', label: 'is after', apply: (v, o) => { const a = s(v), b = os(o); return a != null && b != null && a > b } },
    { id: 'onOrBefore', label: 'is on or before', apply: (v, o) => { const a = s(v), b = os(o); return a != null && b != null && a <= b } },
    { id: 'onOrAfter', label: 'is on or after', apply: (v, o) => { const a = s(v), b = os(o); return a != null && b != null && a >= b } },
    { id: 'between', label: 'is between', apply: (v, o) => { const a = s(v), p = pair(o); return a != null && p != null && a >= p[0] && a <= p[1] } },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => s(v) == null },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => s(v) != null },
  ]
}

function singleSelectOperators(): FilterOperator[] {
  const list = (o: unknown): string[] => (Array.isArray(o) ? o.map(String) : o == null ? [] : [String(o)])
  return [
    { id: 'is', label: 'is', apply: (v, o) => typeof v === 'string' && v === String(o ?? '') },
    { id: 'isNot', label: 'is not', apply: (v, o) => !(typeof v === 'string' && v === String(o ?? '')) },
    { id: 'isAnyOf', label: 'is any of', apply: (v, o) => typeof v === 'string' && list(o).includes(v) },
    { id: 'isNoneOf', label: 'is none of', apply: (v, o) => !(typeof v === 'string' && list(o).includes(v)) },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => v == null },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => v != null },
  ]
}

function multiSelectOperators(): FilterOperator[] {
  const arr = (v: CellValue): string[] => (Array.isArray(v) ? v : [])
  const list = (o: unknown): string[] => (Array.isArray(o) ? o.map(String) : o == null ? [] : [String(o)])
  return [
    { id: 'hasAnyOf', label: 'has any of', apply: (v, o) => { const set = new Set(arr(v)); return list(o).some((x) => set.has(x)) } },
    { id: 'hasAllOf', label: 'has all of', apply: (v, o) => { const set = new Set(arr(v)); return list(o).every((x) => set.has(x)) } },
    { id: 'hasNoneOf', label: 'has none of', apply: (v, o) => { const set = new Set(arr(v)); return !list(o).some((x) => set.has(x)) } },
    { id: 'isEmpty', label: 'is empty', unary: true, apply: (v) => arr(v).length === 0 },
    { id: 'isNotEmpty', label: 'is not empty', unary: true, apply: (v) => arr(v).length > 0 },
  ]
}

// ---------------------------------------------------------------------------
// Number / currency parsing + formatting
// ---------------------------------------------------------------------------

function parseNumeric(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'boolean') return raw ? 1 : 0
  // Strip currency symbols, spaces, and thousands separators; keep sign/decimal.
  const cleaned = String(raw)
    .trim()
    .replace(/[$£€¥,\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return NaN as unknown as number
  const n = Number(cleaned)
  return n
}

function formatNumber(value: number, precision: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision > 0 ? precision : 20,
  })
}

// ---------------------------------------------------------------------------
// Date parsing + formatting
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function isoDateParts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** Parse loosely, normalise to an ISO date string "YYYY-MM-DD", or return null. */
function parseDate(raw: unknown): string | null | undefined {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return undefined
    return toISODate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate())
  }
  const str = String(raw).trim()
  if (str === '') return null

  // Already ISO (date or datetime): take the date part, validate calendar.
  const iso = isoDateParts(str)
  if (iso) {
    if (validCalendar(iso.y, iso.m, iso.d)) return toISODate(iso.y, iso.m, iso.d)
    return undefined
  }

  // US-style M/D/YYYY or D/M/YYYY is ambiguous — prefer M/D/YYYY.
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(str)
  if (slash) {
    let y = Number(slash[3])
    const m = Number(slash[1])
    const d = Number(slash[2])
    if (y < 100) y += 2000
    if (validCalendar(y, m, d)) return toISODate(y, m, d)
    return undefined
  }

  // Fallback to the engine's parser; format via UTC to avoid TZ drift.
  const ms = Date.parse(str)
  if (Number.isNaN(ms)) return undefined
  const dt = new Date(ms)
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function validCalendar(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function formatDate(iso: string, format: string): string {
  const parts = isoDateParts(iso)
  if (!parts) return iso
  const { y, m, d } = parts
  const pad = (n: number) => String(n).padStart(2, '0')
  // Single-pass tokenise so a substituted value (e.g. the "D" in "Dec") is never
  // re-scanned by a later token replace. Longer tokens precede shorter ones.
  const tokens: Record<string, string> = {
    YYYY: String(y).padStart(4, '0'),
    MMMM: MONTHS_LONG[m - 1] ?? '',
    MMM: MONTHS_SHORT[m - 1] ?? '',
    MM: pad(m),
    M: String(m),
    DD: pad(d),
    D: String(d),
  }
  return format.replace(/YYYY|MMMM|MMM|MM|M|DD|D/g, (t) => tokens[t] ?? t)
}

// ---------------------------------------------------------------------------
// URL / phone normalisation
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Keep a single optional leading "+" and the digits.
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return (hasPlus ? '+' : '') + digits
}

// ---------------------------------------------------------------------------
// The registry entries
// ---------------------------------------------------------------------------

const textDef: ColumnTypeDef = {
  type: 'text',
  label: 'Text',
  typeBadge: 'Aa',
  defaultConfig: () => ({ type: 'text' }),
  isEmpty: (v) => emptyString(v),
  validate: (raw) => {
    if (raw == null) return ok(null)
    const s = String(raw)
    return ok(s === '' ? null : s)
  },
  coerce: (value) => (value == null ? null : asString(value) || null),
  formatDisplay: (v) => asString(v),
  toCsv: (v) => asString(v),
  fromCsv: (s) => (s === '' ? null : s),
  filterOperators: textOperators(),
}

const longTextDef: ColumnTypeDef = {
  ...textDef,
  type: 'longText',
  label: 'Long text',
  typeBadge: '¶',
  defaultConfig: () => ({ type: 'longText' }),
}

// An AI column stores text (the primary generated output). It behaves exactly
// like a long-text column for validation / display / CSV / filtering; its
// intelligence lives in the attached AiColumnConfig side-table. An unconfigured
// `ai` column therefore degrades gracefully to an editable text column.
const aiDef: ColumnTypeDef = {
  ...textDef,
  type: 'ai',
  label: 'AI',
  typeBadge: '✦',
  defaultConfig: () => ({ type: 'ai' }),
}

// A web-research agent column (US-3.3/3.4) — like AI, stores text (the answer)
// and degrades to a plain text column when unconfigured. Its config + source
// citations live in the AgentColumnConfig side-table.
const agentDef: ColumnTypeDef = {
  ...textDef,
  type: 'agent',
  label: 'Agent',
  typeBadge: '◆',
  defaultConfig: () => ({ type: 'agent' }),
}

// An HTTP column (US-3.5) — stores the mapped response value as text. Config
// (method/url/headers/mapping) lives in the HttpColumnConfig side-table.
const httpDef: ColumnTypeDef = {
  ...textDef,
  type: 'http',
  label: 'HTTP API',
  typeBadge: '⇄',
  defaultConfig: () => ({ type: 'http' }),
}

// A formula column (US-3.6) — a computed value; the expression lives in the
// FormulaColumnConfig side-table. Stores text (the evaluator coerces the result).
const formulaDef: ColumnTypeDef = {
  ...textDef,
  type: 'formula',
  label: 'Formula',
  typeBadge: 'ƒ',
  defaultConfig: () => ({ type: 'formula' }),
}

const numberDef: ColumnTypeDef = {
  type: 'number',
  label: 'Number',
  typeBadge: '#',
  defaultConfig: (): NumberConfig => ({ type: 'number', precision: 0 }),
  isEmpty: (v) => v == null,
  validate: (raw) => {
    const n = parseNumeric(raw)
    if (n == null) return ok(null)
    if (Number.isNaN(n)) return err('Enter a valid number')
    return ok(n)
  },
  coerce: (value, _from, _to, config) => {
    if (value == null) return null
    const n = parseNumeric(asString(value))
    return n == null || Number.isNaN(n) ? null : round(n, (config as NumberConfig).precision)
  },
  formatDisplay: (v, config) => (typeof v === 'number' ? formatNumber(v, (config as NumberConfig).precision) : ''),
  toCsv: (v) => (typeof v === 'number' ? String(v) : ''),
  fromCsv: (s) => {
    const n = parseNumeric(s)
    return n == null || Number.isNaN(n) ? null : n
  },
  filterOperators: numberOperators(),
}

const currencyDef: ColumnTypeDef = {
  type: 'currency',
  label: 'Currency',
  typeBadge: '$',
  defaultConfig: (): CurrencyConfig => ({ type: 'currency', currencyCode: 'USD', precision: 2 }),
  isEmpty: (v) => v == null,
  validate: (raw) => {
    const n = parseNumeric(raw)
    if (n == null) return ok(null)
    if (Number.isNaN(n)) return err('Enter a valid amount')
    return ok(n)
  },
  coerce: (value, _from, _to, config) => {
    if (value == null) return null
    const n = parseNumeric(asString(value))
    return n == null || Number.isNaN(n) ? null : round(n, (config as CurrencyConfig).precision)
  },
  formatDisplay: (v, config) => {
    if (typeof v !== 'number') return ''
    const cfg = config as CurrencyConfig
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cfg.currencyCode,
        minimumFractionDigits: cfg.precision,
        maximumFractionDigits: cfg.precision,
      }).format(v)
    } catch {
      return `${cfg.currencyCode} ${formatNumber(v, cfg.precision)}`
    }
  },
  toCsv: (v) => (typeof v === 'number' ? String(v) : ''),
  fromCsv: (s) => {
    const n = parseNumeric(s)
    return n == null || Number.isNaN(n) ? null : n
  },
  filterOperators: numberOperators(),
}

const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1', 'checked', 'on'])
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', 'unchecked', 'off'])

const booleanDef: ColumnTypeDef = {
  type: 'boolean',
  label: 'Checkbox',
  typeBadge: '☑',
  defaultConfig: () => ({ type: 'boolean' }),
  isEmpty: (v) => v == null,
  validate: (raw) => {
    if (raw == null || raw === '') return ok(null)
    if (typeof raw === 'boolean') return ok(raw)
    if (typeof raw === 'number') return ok(raw !== 0)
    const t = String(raw).trim().toLowerCase()
    if (TRUE_TOKENS.has(t)) return ok(true)
    if (FALSE_TOKENS.has(t)) return ok(false)
    return err('Enter yes/no or true/false')
  },
  coerce: (value) => {
    if (value == null || value === '') return null
    if (typeof value === 'boolean') return value
    const t = asString(value).trim().toLowerCase()
    if (TRUE_TOKENS.has(t)) return true
    if (FALSE_TOKENS.has(t)) return false
    return null
  },
  formatDisplay: (v) => (v === true ? 'Yes' : v === false ? 'No' : ''),
  toCsv: (v) => (v === true ? 'true' : v === false ? 'false' : ''),
  fromCsv: (s) => {
    const t = s.trim().toLowerCase()
    if (TRUE_TOKENS.has(t)) return true
    if (FALSE_TOKENS.has(t)) return false
    return null
  },
  filterOperators: booleanOperators(),
}

const singleSelectDef: ColumnTypeDef = {
  type: 'singleSelect',
  label: 'Single select',
  typeBadge: '◉',
  defaultConfig: (): SingleSelectConfig => ({ type: 'singleSelect', options: [] }),
  isEmpty: (v) => v == null,
  validate: (raw, config) => {
    if (raw == null || raw === '') return ok(null)
    const opt = findOption((config as SingleSelectConfig).options, String(raw))
    return opt ? ok(opt.id) : err('Not one of the allowed options')
  },
  coerce: (value, _from, _to, config) => {
    if (value == null) return null
    const opt = findOption((config as SingleSelectConfig).options, asString(value))
    return opt ? opt.id : null
  },
  formatDisplay: (v, config) => {
    if (typeof v !== 'string') return ''
    return (config as SingleSelectConfig).options.find((o) => o.id === v)?.label ?? ''
  },
  toCsv: (v, config) => {
    if (typeof v !== 'string') return ''
    return (config as SingleSelectConfig).options.find((o) => o.id === v)?.label ?? ''
  },
  fromCsv: (s, config) => {
    const opt = findOption((config as SingleSelectConfig).options, s)
    return opt ? opt.id : null
  },
  filterOperators: singleSelectOperators(),
}

const multiSelectDef: ColumnTypeDef = {
  type: 'multiSelect',
  label: 'Multi select',
  typeBadge: '⊞',
  defaultConfig: (): MultiSelectConfig => ({ type: 'multiSelect', options: [] }),
  isEmpty: (v) => !Array.isArray(v) || v.length === 0,
  validate: (raw, config) => {
    const options = (config as MultiSelectConfig).options
    if (raw == null || raw === '') return ok([])
    const tokens: string[] = Array.isArray(raw)
      ? raw.map((x) => String(x))
      : String(raw)
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
    const ids: string[] = []
    for (const tok of tokens) {
      const opt = findOption(options, tok)
      if (!opt) return err(`"${tok}" is not an allowed option`)
      if (!ids.includes(opt.id)) ids.push(opt.id)
    }
    return ok(ids)
  },
  coerce: (value, _from, _to, config) => {
    const options = (config as MultiSelectConfig).options
    const tokens: string[] = Array.isArray(value)
      ? value.map((x) => String(x))
      : value == null
        ? []
        : asString(value)
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean)
    const ids: string[] = []
    for (const tok of tokens) {
      const opt = findOption(options, tok)
      if (opt && !ids.includes(opt.id)) ids.push(opt.id)
    }
    return ids
  },
  formatDisplay: (v, config) => {
    if (!Array.isArray(v)) return ''
    const options = (config as MultiSelectConfig).options
    return v
      .map((id) => options.find((o) => o.id === id)?.label ?? '')
      .filter(Boolean)
      .join(MULTI_DELIM)
  },
  toCsv: (v, config) => {
    if (!Array.isArray(v)) return ''
    const options = (config as MultiSelectConfig).options
    return v
      .map((id) => options.find((o) => o.id === id)?.label ?? '')
      .filter(Boolean)
      .join(MULTI_DELIM)
  },
  fromCsv: (s, config) => {
    const options = (config as MultiSelectConfig).options
    const ids: string[] = []
    for (const tok of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      const opt = findOption(options, tok)
      if (opt && !ids.includes(opt.id)) ids.push(opt.id)
    }
    return ids
  },
  filterOperators: multiSelectOperators(),
}

const dateDef: ColumnTypeDef = {
  type: 'date',
  label: 'Date',
  typeBadge: '⌘D',
  defaultConfig: (): DateConfig => ({ type: 'date', format: 'YYYY-MM-DD' }),
  isEmpty: (v) => v == null || v === '',
  validate: (raw) => {
    const parsed = parseDate(raw)
    if (parsed === undefined) return err('Enter a valid date')
    return ok(parsed)
  },
  coerce: (value) => {
    const parsed = parseDate(value)
    return parsed === undefined ? null : parsed
  },
  formatDisplay: (v, config) => (typeof v === 'string' && v !== '' ? formatDate(v, (config as DateConfig).format) : ''),
  toCsv: (v) => (typeof v === 'string' ? v : ''),
  fromCsv: (s) => {
    const parsed = parseDate(s)
    return parsed === undefined ? null : parsed
  },
  filterOperators: dateOperators(),
}

const urlDef: ColumnTypeDef = {
  type: 'url',
  label: 'URL',
  typeBadge: 'URL',
  defaultConfig: () => ({ type: 'url' }),
  isEmpty: (v) => emptyString(v),
  validate: (raw) => {
    if (raw == null || String(raw).trim() === '') return ok(null)
    const norm = normalizeUrl(String(raw))
    return norm ? ok(norm) : err('Enter a valid URL')
  },
  coerce: (value) => (value == null ? null : normalizeUrl(asString(value))),
  formatDisplay: (v) => (typeof v === 'string' ? v.replace(/^https?:\/\//i, '').replace(/\/$/, '') : ''),
  toCsv: (v) => asString(v),
  fromCsv: (s) => (s.trim() === '' ? null : normalizeUrl(s)),
  filterOperators: textOperators(),
}

const emailDef: ColumnTypeDef = {
  type: 'email',
  label: 'Email',
  typeBadge: '@',
  defaultConfig: () => ({ type: 'email' }),
  isEmpty: (v) => emptyString(v),
  validate: (raw) => {
    if (raw == null || String(raw).trim() === '') return ok(null)
    const e = String(raw).trim().toLowerCase()
    return EMAIL_RE.test(e) ? ok(e) : err('Enter a valid email address')
  },
  coerce: (value) => {
    if (value == null) return null
    const e = asString(value).trim().toLowerCase()
    return EMAIL_RE.test(e) ? e : null
  },
  formatDisplay: (v) => asString(v),
  toCsv: (v) => asString(v),
  fromCsv: (s) => {
    const e = s.trim().toLowerCase()
    return e === '' ? null : EMAIL_RE.test(e) ? e : null
  },
  filterOperators: textOperators(),
}

const phoneDef: ColumnTypeDef = {
  type: 'phone',
  label: 'Phone',
  typeBadge: '☎',
  defaultConfig: () => ({ type: 'phone' }),
  isEmpty: (v) => emptyString(v),
  validate: (raw) => {
    if (raw == null || String(raw).trim() === '') return ok(null)
    const p = normalizePhone(String(raw))
    return p ? ok(p) : err('Enter a valid phone number')
  },
  coerce: (value) => (value == null ? null : normalizePhone(asString(value))),
  formatDisplay: (v) => asString(v),
  toCsv: (v) => asString(v),
  fromCsv: (s) => (s.trim() === '' ? null : normalizePhone(s)),
  filterOperators: textOperators(),
}

function round(n: number, precision: number): number {
  if (precision <= 0) return n
  const f = 10 ** precision
  return Math.round(n * f) / f
}

// ---------------------------------------------------------------------------
// The registry + accessors
// ---------------------------------------------------------------------------

/** Fully-mapped record: indexing with a known ColumnType never yields undefined. */
export const columnTypeRegistry: Record<ColumnType, ColumnTypeDef> = {
  text: textDef,
  longText: longTextDef,
  number: numberDef,
  currency: currencyDef,
  boolean: booleanDef,
  singleSelect: singleSelectDef,
  multiSelect: multiSelectDef,
  date: dateDef,
  url: urlDef,
  email: emailDef,
  phone: phoneDef,
  ai: aiDef,
  agent: agentDef,
  http: httpDef,
  formula: formulaDef,
}

/** Iteration order for column-type pickers. */
export const COLUMN_TYPES: ColumnType[] = [
  'text',
  'longText',
  'number',
  'currency',
  'boolean',
  'singleSelect',
  'multiSelect',
  'date',
  'url',
  'email',
  'phone',
  'ai',
  'agent',
  'http',
  'formula',
]

export function getColumnType(type: ColumnType): ColumnTypeDef {
  return columnTypeRegistry[type]
}

export function defaultConfigFor(type: ColumnType): ColumnConfig {
  return columnTypeRegistry[type].defaultConfig()
}

export function validateValue(type: ColumnType, raw: unknown, config: ColumnConfig): ValidateResult {
  return columnTypeRegistry[type].validate(raw, config)
}

/**
 * High-fidelity retyping between two concrete columns. Renders the source value
 * to a canonical CSV string using the SOURCE config (so select labels, formatted
 * numbers and ISO dates survive), then parses it under the TARGET config.
 * Returns `{ value, changed }` where `changed` is true when the coerced value
 * differs from a lossless round-trip (used to surface the "may lose data" warning).
 */
export function coerceColumnValue(
  from: Column,
  to: Column,
  value: CellValue,
): { value: CellValue; lossy: boolean } {
  const src = columnTypeRegistry[from.type]
  const dst = columnTypeRegistry[to.type]
  if (src.isEmpty(value)) {
    return { value: to.type === 'multiSelect' ? [] : null, lossy: false }
  }
  const canonical = src.toCsv(value, from.config)
  const result = dst.validate(canonical, to.config)
  const next = result.ok ? result.value : to.type === 'multiSelect' ? [] : null
  // Lossy if the target rejected it, or the re-rendered value differs.
  const lossy = !result.ok || dst.toCsv(next, to.config) !== canonical
  return { value: next, lossy }
}
