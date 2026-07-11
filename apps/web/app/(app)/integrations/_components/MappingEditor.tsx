'use client'
// Shared CRM field-mapping editor: a list of "CRM field text → column" rows,
// used by both the connect and edit-mapping dialogs. Kept dumb/controlled — the
// parent owns the rows and converts them to a Record<string,string> on save.

import type { Column } from '@cascade/core'
import { Button, Input, Select } from '@cascade/ui'
import styles from '../integrations.module.css'

export interface MappingRow {
  crmField: string
  columnId: string
}

export interface MappingEditorProps {
  rows: MappingRow[]
  columns: Column[]
  onChange: (rows: MappingRow[]) => void
  /** Disable the column selects while the column list is loading. */
  loading?: boolean
}

function RemoveGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function MappingEditor({ rows, columns, onChange, loading = false }: MappingEditorProps) {
  const setRow = (i: number, patch: Partial<MappingRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  const addRow = () => onChange([...rows, { crmField: '', columnId: '' }])

  return (
    <div className={styles.mapEditor}>
      {rows.map((row, i) => (
        <div key={i} className={styles.mapRow}>
          <Input
            aria-label={`CRM field ${i + 1}`}
            placeholder="CRM field"
            value={row.crmField}
            onChange={(e) => setRow(i, { crmField: e.target.value })}
          />
          <span className={styles.mapArrow} aria-hidden="true">
            &rarr;
          </span>
          <Select
            aria-label={`Column ${i + 1}`}
            value={row.columnId}
            disabled={loading}
            onChange={(e) => setRow(i, { columnId: e.target.value })}
          >
            <option value="">Select column…</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className={styles.mapRemove}
            aria-label={`Remove field ${i + 1}`}
            onClick={() => removeRow(i)}
          >
            <RemoveGlyph />
          </button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={addRow}>
        Add field
      </Button>
    </div>
  )
}
