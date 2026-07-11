'use client'
// The HTTP column authoring dialog (US-3.5) — call an external API per row with a
// templated URL / headers / body, then map a JSON path out of the response into
// the cell (plus optional fan-out columns). Secrets are referenced by name and
// never leave the server; the builder only ever shows a masked hint.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Column, HttpHeader, HttpMethod } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, Switch, Tag, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { PromptEditor } from '../ai/PromptEditor'
import styles from '../ai/ai-column.module.css'
import http from './http-column.module.css'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const TTL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]
const NEW_COLUMN = '__new__'

interface HeaderRow {
  key: string
  value: string
  secretRef: string
}
interface MapRow {
  key: string
  field: string
  path: string
  destColumnId: string
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: Column[]
  workspaceId: string
  column: Column | null
  seedName?: string
  onSaved: () => void
}

let rowSeq = 0
const rid = () => `r${rowSeq++}`

export function HttpColumnBuilder({ open, onOpenChange, tableId, columns, workspaceId, column, seedName, onSaved }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [newName, setNewName] = useState('')
  const [method, setMethod] = useState<HttpMethod>('GET')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [responsePath, setResponsePath] = useState('$')
  const [maps, setMaps] = useState<MapRow[]>([])
  const [cacheTtlDays, setCacheTtlDays] = useState(7)
  const [autoRun, setAutoRun] = useState(false)
  const [attempted, setAttempted] = useState(false)

  // In-dialog "add secret" form (replaces the off-brand window.prompt flow).
  const [addingSecret, setAddingSecret] = useState(false)
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const secretsQuery = useQuery({
    queryKey: ['http', 'secrets', workspaceId],
    queryFn: () => getApi().http.secrets.list(workspaceId),
    enabled: open,
  })
  const secrets = secretsQuery.data ?? []

  const configQuery = useQuery({
    queryKey: ['http', 'config', column?.id],
    queryFn: () => getApi().http.configs.get(column!.id),
    enabled: open && !!column,
  })

  useEffect(() => {
    if (!open) return
    setAttempted(false)
    setAddingSecret(false)
    setSecretName('')
    setSecretValue('')
    setNewName(seedName ?? '')
    const cfg = configQuery.data
    if (cfg) {
      setMethod(cfg.method)
      setUrl(cfg.urlTemplate)
      setBody(cfg.bodyTemplate)
      setHeaders(cfg.headers.map((h) => ({ key: h.key, value: h.value, secretRef: h.secretRef ?? '' })))
      setResponsePath(cfg.responsePath)
      setMaps(
        Object.entries(cfg.responseMapping).map(([field, path]) => ({ key: rid(), field, path, destColumnId: cfg.outputMapping[field] ?? NEW_COLUMN })),
      )
      setCacheTtlDays(cfg.cacheTtlDays)
      setAutoRun(cfg.autoRun)
    } else if (!column) {
      setMethod('GET')
      setUrl('')
      setBody('')
      setHeaders([])
      setResponsePath('$')
      setMaps([])
      setCacheTtlDays(7)
      setAutoRun(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configQuery.data, column, seedName])

  const createSecret = useMutation({
    mutationFn: (input: { name: string; token: string }) => getApi().http.secrets.create(workspaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['http', 'secrets', workspaceId] })
      toast('Secret stored', { variant: 'success' })
      setAddingSecret(false)
      setSecretName('')
      setSecretValue('')
    },
    onError: (err) => toast(errorMessage(err, 'Could not store secret'), { variant: 'error' }),
  })

  function submitSecret() {
    const name = secretName.trim()
    const token = secretValue.trim()
    if (!name || !token) return
    createSecret.mutate({ name, token })
  }
  function cancelSecret() {
    setAddingSecret(false)
    setSecretName('')
    setSecretValue('')
  }

  const save = useMutation({
    mutationFn: async () => {
      const api = getApi()
      let anchorId = column?.id
      if (!anchorId) {
        const created = await api.columns.add(tableId, { name: newName.trim(), type: 'http', config: { type: 'http' } })
        anchorId = created.id
      }
      const responseMapping: Record<string, string> = {}
      const outputMapping: Record<string, string> = {}
      for (const m of maps) {
        const field = m.field.trim()
        if (!field || !m.path.trim()) continue
        responseMapping[field] = m.path.trim()
        let destId = m.destColumnId
        if (destId === NEW_COLUMN) {
          const created = await api.columns.add(tableId, { name: field, type: 'text', config: { type: 'text' } })
          destId = created.id
        }
        outputMapping[field] = destId
      }
      const cleanHeaders: HttpHeader[] = headers
        .filter((h) => h.key.trim())
        .map((h) => (h.secretRef ? { key: h.key.trim(), value: '', secretRef: h.secretRef } : { key: h.key.trim(), value: h.value }))
      return api.http.configs.upsert({
        columnId: anchorId,
        method,
        urlTemplate: url.trim(),
        headers: cleanHeaders,
        bodyTemplate: method === 'GET' ? '' : body,
        responsePath: responsePath.trim() || '$',
        responseMapping,
        outputMapping,
        cacheTtlDays,
        autoRun,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      void qc.invalidateQueries({ queryKey: ['http', 'configs', tableId] })
      if (column) void qc.invalidateQueries({ queryKey: ['http', 'config', column.id] })
      toast('HTTP column saved', { variant: 'success' })
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the HTTP column'), { variant: 'error' }),
  })

  const nameError = !column && newName.trim() === '' ? 'Name the HTTP column' : null
  const urlError = url.trim() === '' ? 'Enter a request URL' : null

  function validateAndSave() {
    setAttempted(true)
    if (nameError || urlError) return
    save.mutate()
  }

  const nonGet = method !== 'GET'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="HTTP API column"
      description="Call an external API per row with a templated URL, headers and body, then map a value out of the JSON response. Non-2xx responses surface as Failed."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={validateAndSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save HTTP column'}
          </Button>
        </>
      }
    >
      <div className={styles.builder}>
        <div className={styles.builderHead}>
          {column ? (
            <span className={styles.anchorName}>{column.name}</span>
          ) : (
            <Field
              label="Column name (required)"
              htmlFor="http-col-name"
              hint={attempted && nameError ? nameError : undefined}
              error={attempted && !!nameError}
            >
              <Input id="http-col-name" autoFocus placeholder="e.g. HTTP: HQ city" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}
          <Tag mono tone="gold" className={styles.estTag}>
            est. ≤ 1 cr/row
          </Tag>
        </div>

        <div className={http.reqRow}>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Request URL (required)"
            hint={attempted && urlError ? urlError : 'Insert {{column}} references; substituted per row.'}
            error={attempted && !!urlError}
          >
            <PromptEditor label="Request URL" value={url} onChange={setUrl} columns={columns} />
          </Field>
        </div>

        <Field label="Headers">
          <div className={http.rows}>
            {headers.map((h, i) => (
              <div key={i} className={http.headerRow}>
                <Input aria-label="Header name" placeholder="Header" value={h.key} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                {h.secretRef ? (
                  <Select aria-label="Header secret" value={h.secretRef} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, secretRef: e.target.value } : r)))}>
                    {secrets.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.maskedHint})</option>
                    ))}
                  </Select>
                ) : (
                  <Input aria-label="Header value" placeholder="Value" value={h.value} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
                )}
                <Select
                  aria-label="Value source"
                  value={h.secretRef ? 'secret' : 'literal'}
                  onChange={(e) => {
                    const useSecret = e.target.value === 'secret'
                    setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, secretRef: useSecret ? secrets[0]?.id ?? '' : '', value: useSecret ? '' : r.value } : r)))
                  }}
                >
                  <option value="literal">Literal</option>
                  <option value="secret">Secret</option>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setHeaders((rows) => rows.filter((_, j) => j !== i))} aria-label="Remove header">✕</Button>
              </div>
            ))}
            <div className={http.rowActions}>
              <Button variant="ghost" size="sm" onClick={() => setHeaders((rows) => [...rows, { key: '', value: '', secretRef: '' }])}>+ Header</Button>
              {!addingSecret && (
                <Button variant="ghost" size="sm" onClick={() => setAddingSecret(true)}>+ Store a secret</Button>
              )}
            </div>
            {addingSecret && (
              <div className={http.secretForm} role="group" aria-labelledby="http-secret-head">
                <span id="http-secret-head" className={http.secretHead}>Store a secret</span>
                <div className={http.secretRow}>
                  <Input
                    aria-label="Secret name"
                    placeholder="Name (e.g. API key)"
                    value={secretName}
                    onChange={(e) => setSecretName(e.target.value)}
                  />
                  <Input
                    type="password"
                    aria-label="Secret value"
                    placeholder="Value"
                    autoComplete="off"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                  />
                </div>
                <span className={http.secretHint}>Stored securely and never shown again — only a masked hint appears afterwards.</span>
                <div className={http.rowActions}>
                  <Button variant="ghost" size="sm" onClick={cancelSecret} disabled={createSecret.isPending}>Cancel</Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={submitSecret}
                    loading={createSecret.isPending}
                    disabled={!secretName.trim() || !secretValue.trim()}
                  >
                    Save secret
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Field>

        {nonGet && (
          <Field label="Request body" hint="JSON with {{column}} references.">
            <PromptEditor label="Request body" value={body} onChange={setBody} columns={columns} />
          </Field>
        )}

        <Field label="Response value" hint="JSON path into the response for this column, e.g. data.city or $ for the whole body.">
          <Input value={responsePath} onChange={(e) => setResponsePath(e.target.value)} placeholder="data.city" />
        </Field>

        <Field label="Map extra fields to columns">
          <div className={http.rows}>
            {maps.map((m, i) => (
              <div key={m.key} className={http.mapRow}>
                <Input aria-label="Field name" placeholder="Field" value={m.field} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))} />
                <Input aria-label="JSON path" placeholder="JSON path" value={m.path} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)))} />
                <Select aria-label="Destination column" value={m.destColumnId} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, destColumnId: e.target.value } : r)))}>
                  <option value={NEW_COLUMN}>Create column</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setMaps((rows) => rows.filter((_, j) => j !== i))} aria-label="Remove mapping">✕</Button>
              </div>
            ))}
            <div className={http.rowActions}>
              <Button variant="ghost" size="sm" onClick={() => setMaps((rows) => [...rows, { key: rid(), field: '', path: '', destColumnId: NEW_COLUMN }])}>+ Mapping</Button>
            </div>
          </div>
        </Field>

        <div className={styles.row2}>
          <Field label="Cache results">
            <Select value={String(cacheTtlDays)} onChange={(e) => setCacheTtlDays(Number(e.target.value))}>
              {TTL_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <div className={styles.switchRow}>
            <span className={styles.lbl}>Auto-run on new rows</span>
            <Switch checked={autoRun} onCheckedChange={setAutoRun} aria-label="Auto-run on new rows" />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
