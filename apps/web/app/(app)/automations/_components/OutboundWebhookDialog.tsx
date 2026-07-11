'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Column, OutboundCondition, RowEvent, TableMeta } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import styles from '../automations.module.css'

type CondOp = OutboundCondition['op']

/**
 * Create-outbound-webhook dialog. On a row event (optionally gated by a simple
 * column condition), Cascade POSTs the selected fields to the target URL.
 */
export function OutboundWebhookDialog({
  open,
  onOpenChange,
  workspaceId,
  tables,
  columnsByTable,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  tables: TableMeta[]
  columnsByTable: Record<string, Column[]>
  onSaved: () => void
}) {
  const { toast } = useToast()
  const firstTableId = tables[0]?.id ?? ''

  const [name, setName] = useState('')
  const [tableId, setTableId] = useState(firstTableId)
  const [url, setUrl] = useState('')
  const [event, setEvent] = useState<RowEvent>('record.created')
  const [condColumnId, setCondColumnId] = useState('')
  const [condOp, setCondOp] = useState<CondOp>('notEmpty')
  const [condValue, setCondValue] = useState('')
  const [fieldColumnIds, setFieldColumnIds] = useState<string[]>([])

  const columns = columnsByTable[tableId] ?? []

  const reset = () => {
    setName('')
    setTableId(firstTableId)
    setUrl('')
    setEvent('record.created')
    setCondColumnId('')
    setCondOp('notEmpty')
    setCondValue('')
    setFieldColumnIds([])
  }

  const toggleField = (id: string) =>
    setFieldColumnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const condition: OutboundCondition | undefined = condColumnId
    ? {
        columnId: condColumnId,
        op: condOp,
        ...(condOp === 'equals' ? { value: condValue } : {}),
      }
    : undefined

  const mutation = useMutation({
    mutationFn: () =>
      getApi().automation.webhooks.createOutbound(workspaceId, {
        tableId,
        name: name.trim(),
        url: url.trim(),
        event,
        condition,
        fieldColumnIds,
      }),
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
      reset()
      toast('Outbound webhook created', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not create the webhook'), { variant: 'error' }),
  })

  const canSave = Boolean(name.trim() && tableId && /^https?:\/\//i.test(url.trim()))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
      title="New outbound webhook"
      description="POST selected fields to an external URL when a row event fires."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create webhook'}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="out-name">
        <Input
          id="out-name"
          autoFocus
          placeholder="Notify ops"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Table" htmlFor="out-table">
        <Select
          id="out-table"
          value={tableId}
          onChange={(e) => {
            setTableId(e.target.value)
            setCondColumnId('')
            setFieldColumnIds([])
          }}
        >
          {tables.length === 0 && <option value="">No tables</option>}
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Target URL" type="URL" htmlFor="out-url">
        <Input
          id="out-url"
          type="url"
          placeholder="https://example.com/hooks/cascade"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>

      <Field label="Fires on" htmlFor="out-event">
        <Select id="out-event" value={event} onChange={(e) => setEvent(e.target.value as RowEvent)}>
          <option value="record.created">Record created</option>
          <option value="record.updated">Record updated</option>
        </Select>
      </Field>

      <Field label="Condition" hint="Optional — only fire when a column matches.">
        <div className={styles.condRow}>
          <Select
            aria-label="Condition column"
            value={condColumnId}
            onChange={(e) => setCondColumnId(e.target.value)}
          >
            <option value="">Always fire</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {condColumnId && (
            <Select aria-label="Condition operator" value={condOp} onChange={(e) => setCondOp(e.target.value as CondOp)}>
              <option value="notEmpty">is not empty</option>
              <option value="changed">changed</option>
              <option value="equals">equals</option>
            </Select>
          )}
        </div>
      </Field>

      {condColumnId && condOp === 'equals' && (
        <Field label="Equals value" htmlFor="out-cond-value">
          <Input id="out-cond-value" value={condValue} onChange={(e) => setCondValue(e.target.value)} />
        </Field>
      )}

      <Field label="Payload fields" hint="Leave all unchecked to send every column.">
        {columns.length === 0 ? (
          <span className={styles.sectionHint}>No columns in this table.</span>
        ) : (
          <div className={styles.checkGrid}>
            {columns.map((c) => (
              <label key={c.id} className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={fieldColumnIds.includes(c.id)}
                  onChange={() => toggleField(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </Field>
    </Dialog>
  )
}
