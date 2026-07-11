'use client'
// InstantiateDialog (US-4.9) — confirms turning a curated template into a real
// table. Surfaces the column recipe and the per-row credit estimate BEFORE
// anything runs, making the cost clear up front. Creating the table is free;
// credits are only spent when the configured columns are actually run.

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Template, TableMeta, ColumnType } from '@cascade/core'
import { canWrite } from '@cascade/core'
import { Alert, Button, Dialog, DialogClose, Field, Input, Tag } from '@cascade/ui'
import { useSession } from '../../../session'
import { errorMessage } from '../../../lib/ui'
import styles from '../templates.module.css'

const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text',
  longText: 'Long text',
  number: 'Number',
  currency: 'Currency',
  boolean: 'Checkbox',
  singleSelect: 'Single select',
  multiSelect: 'Multi select',
  date: 'Date',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
  ai: 'AI',
  agent: 'Agent',
  http: 'HTTP',
  formula: 'Formula',
}

/** Which configured recipe drives a template column, if any (by column NAME). */
function kindForColumn(t: Template, name: string): { label: string; tone: 'brand' | 'cobalt' | 'default' } | null {
  if (t.enrichment?.some((e) => e.columnName === name)) return { label: 'Waterfall', tone: 'brand' }
  if (t.ai?.some((a) => a.columnName === name)) return { label: 'AI', tone: 'cobalt' }
  if (t.agent?.some((a) => a.columnName === name)) return { label: 'Agent', tone: 'cobalt' }
  if (t.formula?.some((f) => f.columnName === name)) return { label: 'Formula', tone: 'default' }
  return null
}

export function InstantiateDialog(props: {
  open: boolean
  onOpenChange: (o: boolean) => void
  workspaceId: string
  template: Template | null
  onInstantiated: (table: TableMeta) => void
}) {
  const { open, onOpenChange, workspaceId, template, onInstantiated } = props
  const { role } = useSession()
  const writable = role ? canWrite(role) : false

  const [name, setName] = useState('')

  // Seed the table-name input from the template each time a template is picked.
  useEffect(() => {
    if (template) setName(template.tableName)
  }, [template])

  const mutation = useMutation({
    mutationFn: (tableName: string) =>
      getApi().templates.instantiate(workspaceId, template!.id, { tableName: tableName || undefined }),
    onSuccess: (table) => onInstantiated(table),
  })

  function submit() {
    if (!template || !writable || mutation.isPending) return
    mutation.mutate(name.trim())
  }

  const creditsPerRow = template?.creditsPerRow ?? 0
  const isFree = creditsPerRow <= 0

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) mutation.reset()
        onOpenChange(o)
      }}
      title={template ? `Create “${template.name}”` : 'Create from template'}
      description={template ? `A new table with ${template.columns.length} columns, configured and ready to run.` : undefined}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={submit} disabled={!template || !writable || mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create table'}
          </Button>
        </>
      }
    >
      {template && (
        <>
          {!writable && (
            <Alert variant="warn" title="View only" className={styles.state}>
              You need a member role or higher to create tables from templates.
            </Alert>
          )}

          {mutation.isError && (
            <Alert variant="error" title="Couldn’t create the table" className={styles.state}>
              {errorMessage(mutation.error)}
            </Alert>
          )}

          <p className={styles.dlgSummary}>{template.summary}</p>

          {/* ---- Credit estimate (clear before running) ---- */}
          <div className={[styles.creditLine, isFree ? styles.creditFree : ''].filter(Boolean).join(' ')}>
            <span className={[styles.creditVal, isFree ? styles.creditValFree : ''].filter(Boolean).join(' ')}>
              {isFree ? 'Free' : `≤ ${creditsPerRow} cr/row`}
            </span>
            <span className={styles.creditText}>
              {isFree
                ? 'No configured columns — this template never consumes credits.'
                : `Up to ${creditsPerRow} credits per row when the configured columns are run.`}
            </span>
          </div>
          <p className={styles.creditNote}>
            Creating the table is free — credits are only spent when you run the columns, and you’ll see a final
            estimate before each run.
          </p>

          {/* ---- Column recipe ---- */}
          <div className={styles.dlgSectionLabel}>Columns</div>
          <div className={styles.colList}>
            {template.columns.map((c) => {
              const kind = kindForColumn(template, c.name)
              return (
                <div key={c.name} className={styles.colRow}>
                  <span className={styles.colName}>{c.name}</span>
                  {kind && (
                    <Tag mono tone={kind.tone}>
                      {kind.label}
                    </Tag>
                  )}
                  <span className={styles.colType}>{COLUMN_TYPE_LABEL[c.type]}</span>
                </div>
              )
            })}
          </div>

          {/* ---- Table name ---- */}
          <Field label="Table name" htmlFor="tpl-table-name" hint="You can rename it anytime.">
            <Input
              id="tpl-table-name"
              value={name}
              disabled={!writable}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </Field>
        </>
      )}
    </Dialog>
  )
}
