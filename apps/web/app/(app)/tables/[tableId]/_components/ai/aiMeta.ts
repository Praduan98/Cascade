// UI-side metadata for AI columns — operation labels and prompt-reference
// parsing, the AI analog of enrichment/opMeta.ts.

import type { AiOperation, Column } from '@cascade/core'
import { extractReferences } from '@cascade/core'

export const AI_OPERATIONS: { value: AiOperation; label: string; hint: string }[] = [
  { value: 'summarize', label: 'Summarize', hint: 'Condense the referenced fields into a short summary.' },
  { value: 'classify', label: 'Classify', hint: 'Return a single label or category.' },
  { value: 'extract', label: 'Extract', hint: 'Pull specific values out of the referenced text.' },
  { value: 'generate', label: 'Generate', hint: 'Write new text from the referenced fields.' },
]

/** Split a prompt's {{references}} into ones that match a column and ones that don't. */
export function parseRefs(prompt: string, columns: Column[]): { known: string[]; unknown: string[] } {
  const byName = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c] as const))
  const known: string[] = []
  const unknown: string[] = []
  for (const name of extractReferences(prompt)) {
    if (byName.has(name.trim().toLowerCase())) known.push(name)
    else unknown.push(name)
  }
  return { known, unknown }
}

/** Field types offered in the structured-output schema builder. */
export const SCHEMA_FIELD_TYPES: { value: Column['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longText', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
]
