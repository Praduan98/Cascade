'use client'
// DOM overlay editors for the custom cells. Unlike the cell surface (canvas),
// the editor is real DOM, so it is styled directly from the token layer via CSS
// variables. These are intentionally lean Phase-1 editors — a text input, a
// textarea (long text), and a label input for selects. Richer editors (option
// pickers, date pickers) arrive in the interaction stage; the seam is the
// `draft` buffer, which any future editor writes into.

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { ProvideEditorComponent } from '@glideapps/glide-data-grid'
import type { CascadeCell, CascadeCellData } from './types'
import { editStringFor } from './values'

const fieldStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: '8px 10px',
  border: '1px solid var(--border, #263a49)',
  borderRadius: 'var(--r-sm, 5px)',
  background: 'var(--surface, #0f1a23)',
  color: 'var(--text, #e9f1f3)',
  fontFamily: 'var(--font-body, system-ui, sans-serif)',
  fontSize: '13px',
  lineHeight: 1.4,
  outline: 'none',
}

function seed(value: CascadeCell, initialValue: string | undefined): string {
  return initialValue ?? editStringFor(value.data)
}

function withDraft(value: CascadeCell, draft: string): CascadeCell {
  const data: CascadeCellData = { ...value.data, draft }
  return { ...value, data, copyData: draft }
}

/** Single-line editor for text / url / email / phone / number / currency / date / selects. */
export const CascadeTextEditor: ProvideEditorComponent<CascadeCell> = (props) => {
  const { value, onChange, onFinishedEditing, initialValue } = props
  const seededRef = useRef(false)

  // On open, seed the draft (honours "type to replace" via initialValue) so the
  // committed edit is well-defined even if the user immediately confirms.
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (value.data.draft === undefined) onChange(withDraft(value, seed(value, initialValue)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = value.data.draft ?? seed(value, initialValue)

  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      style={fieldStyle}
      value={current}
      inputMode={value.data.numeric ? 'decimal' : 'text'}
      onChange={(e) => onChange(withDraft(value, e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFinishedEditing(withDraft(value, e.currentTarget.value), [0, 1] as const)
        else if (e.key === 'Escape') onFinishedEditing(undefined)
      }}
    />
  )
}

/** Multi-line editor for long text. */
export const CascadeLongTextEditor: ProvideEditorComponent<CascadeCell> = (props) => {
  const { value, onChange, onFinishedEditing, initialValue } = props
  const seededRef = useRef(false)

  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (value.data.draft === undefined) onChange(withDraft(value, seed(value, initialValue)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = value.data.draft ?? seed(value, initialValue)

  return (
    <textarea
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      rows={4}
      style={{ ...fieldStyle, resize: 'vertical', minHeight: 88 }}
      value={current}
      onChange={(e) => onChange(withDraft(value, e.target.value))}
      onKeyDown={(e) => {
        // Enter inserts a newline; Cmd/Ctrl+Enter or Escape finishes.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onFinishedEditing(withDraft(value, e.currentTarget.value), [0, 1] as const)
        else if (e.key === 'Escape') onFinishedEditing(undefined)
      }}
    />
  )
}
