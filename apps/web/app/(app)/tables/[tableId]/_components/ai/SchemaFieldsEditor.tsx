'use client'
// Structured-output schema builder (US-3.2) — the AI analog of OptionsEditor.
// Each row is a named, typed field that fans out to its own column (an existing
// one, or a newly-created column on save).

import type { Column, ColumnType } from '@cascade/core'
import { Input, Select } from '@cascade/ui'
import { SCHEMA_FIELD_TYPES } from './aiMeta'
import styles from './ai-column.module.css'

export interface DraftField {
  key: string
  name: string
  type: ColumnType
  /** '__new__' to create a column named after the field, or an existing column id. */
  destColumnId: string
}

export const NEW_COLUMN = '__new__'

let fieldSeq = 0
export function newField(): DraftField {
  return { key: `f_${fieldSeq++}`, name: '', type: 'text', destColumnId: NEW_COLUMN }
}

/** Drop fields with a blank name and trim the rest. */
export function cleanFields(fields: DraftField[]): DraftField[] {
  return fields.filter((f) => f.name.trim() !== '').map((f) => ({ ...f, name: f.name.trim() }))
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  )
}

interface Props {
  fields: DraftField[]
  columns: Column[]
  onChange: (fields: DraftField[]) => void
}

export function SchemaFieldsEditor({ fields, columns, onChange }: Props) {
  function update(key: string, patch: Partial<DraftField>) {
    onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }
  function remove(key: string) {
    onChange(fields.filter((f) => f.key !== key))
  }
  function add() {
    onChange([...fields, newField()])
  }

  return (
    <div className={styles.schema}>
      {fields.length === 0 && <span className={styles.schemaHint}>No fields yet — add the first field below.</span>}
      {fields.map((f) => (
        <div key={f.key} className={styles.schemaRow}>
          <Input value={f.name} placeholder="field_name" aria-label="Field name" onChange={(e) => update(f.key, { name: e.target.value })} />
          <Select value={f.type} aria-label="Field type" onChange={(e) => update(f.key, { type: e.target.value as ColumnType })}>
            {SCHEMA_FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select value={f.destColumnId} aria-label="Output column" onChange={(e) => update(f.key, { destColumnId: e.target.value })}>
            <option value={NEW_COLUMN}>— create column —</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <button type="button" className={styles.iconBtn} onClick={() => remove(f.key)} aria-label="Remove field">
            <TrashIcon />
          </button>
        </div>
      ))}
      <button type="button" className={['btn', 'btn-ghost', 'btn-sm', styles.schemaAdd].join(' ')} onClick={add}>
        + Add field
      </button>
    </div>
  )
}
