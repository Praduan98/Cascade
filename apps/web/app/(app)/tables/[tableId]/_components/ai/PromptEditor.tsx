'use client'
// The prompt editor for an AI column: a textarea plus an "Insert column"
// menu that injects {{Column}} references at the caret, a live cobalt chip
// preview of the detected references, and a warning for any that don't match a
// column. A plain textarea can't style interior ranges, so the chip row (reusing
// the system's cobalt `.ref` language) is the honest, low-risk affordance.

import { useRef } from 'react'
import type { Column } from '@cascade/core'
import { getColumnType } from '@cascade/core'
import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Tag,
  Textarea,
} from '@cascade/ui'
import { parseRefs } from './aiMeta'
import styles from './ai-column.module.css'

interface Props {
  value: string
  onChange: (v: string) => void
  columns: Column[]
}

export function PromptEditor({ value, onChange, columns }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const { known, unknown } = parseRefs(value, columns)

  function insert(name: string) {
    const token = `{{${name}}}`
    const el = ref.current
    if (!el) {
      onChange(value + token)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className={styles.prompt}>
      <div className={styles.promptHead}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" type="button" className={styles.insertBtn}>
              {'{ }'} Insert column
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Reference a column</DropdownMenuLabel>
            {columns.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => insert(c.name)}>
                <span className={styles.itemBadge}>{getColumnType(c.type).typeBadge}</span>
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'Write a one-line pitch for {{Company}} ({{Domain}})…'}
        aria-label="AI prompt"
      />

      <div className={styles.refRow}>
        {known.length === 0 && unknown.length === 0 ? (
          <span className={styles.refHint}>{'Insert {{column}} references to feed cell values into the prompt.'}</span>
        ) : (
          <>
            {known.map((n) => (
              <Tag key={`k-${n}`} tone="cobalt" mono>
                {`{{${n}}}`}
              </Tag>
            ))}
            {unknown.map((n) => (
              <span key={`u-${n}`} className={styles.refUnknown}>
                {`{{${n}}}`}
              </span>
            ))}
          </>
        )}
      </div>

      {unknown.length > 0 && (
        <Alert variant="warn">
          {unknown.length === 1
            ? `1 reference (${unknown.map((n) => `{{${n}}}`).join(', ')}) doesn't match a column — it will be sent as literal text.`
            : `${unknown.length} references (${unknown.map((n) => `{{${n}}}`).join(', ')}) don't match a column — they will be sent as literal text.`}
        </Alert>
      )}
    </div>
  )
}
