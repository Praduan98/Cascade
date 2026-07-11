'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { InboundWebhookCreated } from '@cascade/data'
import type { Column, TableMeta } from '@cascade/core'
import { Alert, Button, Dialog, DialogClose, Field, Input, Select, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import styles from '../automations.module.css'

interface MapRow {
  field: string
  columnId: string
}

/**
 * Create-inbound-webhook dialog. Collects a name, target table, and a set of
 * "incoming JSON key → column" mapping rows. On create the endpoint URL + secret
 * are returned once and revealed in-place with a copy affordance; they are
 * masked forever after this dialog closes.
 */
export function InboundWebhookDialog({
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
  const [rows, setRows] = useState<MapRow[]>([{ field: '', columnId: '' }])
  const [created, setCreated] = useState<InboundWebhookCreated | null>(null)

  const columns = columnsByTable[tableId] ?? []

  const reset = () => {
    setName('')
    setTableId(firstTableId)
    setRows([{ field: '', columnId: '' }])
    setCreated(null)
  }

  const setRow = (i: number, patch: Partial<MapRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((prev) => [...prev, { field: '', columnId: '' }])
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  const mapping = rows.reduce<Record<string, string>>((acc, r) => {
    const key = r.field.trim()
    if (key && r.columnId) acc[key] = r.columnId
    return acc
  }, {})

  const mutation = useMutation({
    mutationFn: () =>
      getApi().automation.webhooks.createInbound(workspaceId, { tableId, name: name.trim(), mapping }),
    onSuccess: (res) => {
      setCreated(res)
      onSaved()
      toast('Inbound webhook created', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not create the webhook'), { variant: 'error' }),
  })

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast(`${label} copied`, { variant: 'success' }),
      () => toast('Copy failed — select and copy manually', { variant: 'error' }),
    )
  }

  const close = () => {
    onOpenChange(false)
    reset()
  }

  const canSave = Boolean(name.trim() && tableId && Object.keys(mapping).length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
      title={created ? 'Webhook endpoint ready' : 'New inbound webhook'}
      description={
        created
          ? 'Copy the URL and signing secret now — the secret is shown only once.'
          : 'External services POST JSON to this endpoint to create rows in a table.'
      }
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create webhook'}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className={styles.secretBox}>
          <Alert variant="warn" title="Store the secret now">
            You won&rsquo;t be able to see the signing secret again. It&rsquo;s masked everywhere after you close this.
          </Alert>
          <div>
            <div className={styles.secretLabel}>Endpoint URL</div>
            <div className={styles.secretRow}>
              <span className={styles.secretVal}>{created.url}</span>
              <Button variant="secondary" size="sm" onClick={() => copy(created.url, 'URL')}>
                Copy
              </Button>
            </div>
          </div>
          <div>
            <div className={styles.secretLabel}>Signing secret</div>
            <div className={styles.secretRow}>
              <span className={styles.secretVal}>{created.secret}</span>
              <Button variant="secondary" size="sm" onClick={() => copy(created.secret, 'Secret')}>
                Copy
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <Field label="Name" htmlFor="in-name">
            <Input
              id="in-name"
              autoFocus
              placeholder="Typeform submissions"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Table" htmlFor="in-table">
            <Select
              id="in-table"
              value={tableId}
              onChange={(e) => {
                setTableId(e.target.value)
                setRows([{ field: '', columnId: '' }])
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

          <Field label="Field mapping" hint="Map incoming JSON keys to destination columns.">
            <div>
              {rows.map((r, i) => (
                <div key={i} className={styles.mapRow}>
                  <Input
                    aria-label="Incoming JSON key"
                    placeholder="email"
                    value={r.field}
                    onChange={(e) => setRow(i, { field: e.target.value })}
                  />
                  <ArrowGlyph />
                  <Select
                    aria-label="Destination column"
                    value={r.columnId}
                    onChange={(e) => setRow(i, { columnId: e.target.value })}
                  >
                    <option value="">Choose column…</option>
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Remove mapping row"
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                  >
                    <TrashGlyph />
                  </button>
                </div>
              ))}
              <div className={styles.addRow}>
                <Button variant="ghost" size="sm" onClick={addRow}>
                  Add mapping
                </Button>
              </div>
            </div>
          </Field>
        </>
      )}
    </Dialog>
  )
}

function ArrowGlyph() {
  return (
    <svg
      className={styles.arrow}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    </svg>
  )
}
