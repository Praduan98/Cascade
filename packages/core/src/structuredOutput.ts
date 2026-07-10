// @cascade/core — structured-output validation (Phase 3, FR-3.2).
//
// One shared subsystem that coerces a raw model object against a defined output
// schema, reusing the column-type registry so each field lands as a valid typed
// value. Malformed output can be repaired once (strip code fences / trailing
// commas → JSON.parse). A field that cannot be produced is reported Empty with a
// reason while valid fields still populate (US-3.2). Framework-agnostic.

import type { AiOutputField, CellValue, ColumnConfig, ColumnType } from './types'
import { columnTypeRegistry, defaultConfigFor } from './columnTypes'

export interface FieldValidation {
  ok: boolean
  value?: CellValue
  reason?: string
}

export interface StructuredValidation {
  fields: Record<string, FieldValidation>
}

/**
 * Validate `raw` against `schema`, coercing each field through the column-type
 * registry. Coercion is keyed on the DESTINATION column's type (`typeFor`) and
 * config (`configFor`), NOT the schema field's declared type — the two can
 * diverge (a field mapped to an existing column of a different type), and using
 * the field type there would either write a wrong-typed value raw into a typed
 * column or crash a select validator with a config that has no `options`. When a
 * field has no destination, both resolvers fall back to the field's own type.
 */
export function validateStructured(
  raw: unknown,
  schema: AiOutputField[],
  configFor?: (field: AiOutputField) => ColumnConfig,
  typeFor?: (field: AiOutputField) => ColumnType,
): StructuredValidation {
  const fields: Record<string, FieldValidation> = {}
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  for (const field of schema) {
    if (!obj) {
      fields[field.name] = { ok: false, reason: 'malformed output' }
      continue
    }
    const rawVal = obj[field.name]
    if (rawVal == null || rawVal === '') {
      fields[field.name] = { ok: false, reason: 'field missing' }
      continue
    }
    const type = typeFor ? typeFor(field) : field.type
    const config = configFor ? configFor(field) : defaultConfigFor(type)
    const res = columnTypeRegistry[type].validate(rawVal, config)
    fields[field.name] = res.ok ? { ok: true, value: res.value } : { ok: false, reason: res.error }
  }
  return { fields }
}

/**
 * Best-effort repair of a stringified/fenced object. Returns the parsed object,
 * or `undefined` if unrecoverable. Objects pass through unchanged.
 */
export function repairStructured(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence?.[1] != null) s = fence[1].trim()
  s = s.replace(/,\s*([}\]])/g, '$1') // trailing commas
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
