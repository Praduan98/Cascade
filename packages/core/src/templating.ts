// @cascade/core — prompt templating (Phase 3, FR-3.3).
//
// One shared subsystem for {{Column Name}} references, used by AI columns now
// and (later) the web-research agent, HTTP columns, and outbound webhooks. A
// reference that resolves to a blank value (null / '' / []) is reported as
// `missing` so the caller can mark the cell Empty and charge nothing (US-3.1).
// Framework-agnostic; no data-layer dependency.

import type { CellValue } from './types'

export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; name: string }

const REF_SOURCE = '\\{\\{\\s*([^}]+?)\\s*\\}\\}'

/** Split a template into interleaved text/ref tokens. Unmatched braces stay literal text. */
export function parseTemplate(s: string): TemplateToken[] {
  const tokens: TemplateToken[] = []
  const re = new RegExp(REF_SOURCE, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: s.slice(last, m.index) })
    tokens.push({ kind: 'ref', name: (m[1] ?? '').trim() })
    last = m.index + m[0].length
  }
  if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) })
  return tokens
}

/** Distinct reference names, in first-appearance order. */
export function extractReferences(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of parseTemplate(s)) {
    if (t.kind === 'ref' && !seen.has(t.name)) {
      seen.add(t.name)
      out.push(t.name)
    }
  }
  return out
}

export interface ResolveResult {
  /** The template with references substituted (missing refs render as empty). */
  text: string
  /** Distinct reference names that resolved to a blank/undefined value. */
  missing: string[]
}

/** A value that reads as "empty" — the same predicate the engine uses for inputs.
 * Must match @cascade/data isEmptyInput exactly (incl. trimming whitespace-only
 * strings) so the pre-run estimate and the actual run agree on which rows are
 * billable — otherwise a whitespace-only reference is counted free by the
 * estimate but charged by the run, bypassing the per-run cap / budget. */
function isBlankValue(v: CellValue | undefined): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

/** Canonicalise a cell value for prompt substitution. */
function canonicalize(v: CellValue): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

/**
 * Render tokens with a caller-supplied resolver. A ref whose resolver returns
 * `undefined` or a blank value is recorded in `missing` (deduped, ordered) and
 * substituted as empty text.
 */
export function resolveTemplate(
  tokens: TemplateToken[],
  resolve: (name: string) => CellValue | undefined,
): ResolveResult {
  const missing: string[] = []
  const seenMissing = new Set<string>()
  let text = ''
  for (const t of tokens) {
    if (t.kind === 'text') {
      text += t.value
      continue
    }
    const v = resolve(t.name)
    if (isBlankValue(v)) {
      if (!seenMissing.has(t.name)) {
        seenMissing.add(t.name)
        missing.push(t.name)
      }
      continue
    }
    text += canonicalize(v as CellValue)
  }
  return { text, missing }
}
