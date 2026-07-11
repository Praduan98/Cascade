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
    },
    onError: (err) => toast(errorMessage(err, 'Could not store secret'), { variant: 'error' }),
  })

  function addSecret() {
    const name = window.prompt('Secret name (e.g. "API key")')?.trim()
    if (!name) return
    const token = window.prompt('Secret value — stored securely, never shown again')?.trim()
    if (!token) return
    createSecret.mutate({ name, token })
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

  function validateAndSave() {
    if (!column && newName.trim() === '') {
      toast('Name the HTTP column', { variant: 'warn' })
      return
    }
    if (url.trim() === '') {
      toast('Enter a request URL', { variant: 'warn' })
      return
    }
    save.mutate()
  }

  const nonGet = method !== 'GET'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
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
            <Field label="Column name" htmlFor="http-col-name">
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
          <Field label="Request URL" hint="Insert {{column}} references; substituted per row.">
            <PromptEditor value={url} onChange={setUrl} columns={columns} />
          </Field>
        </div>

        <Field label="Headers">
          <div className={http.rows}>
            {headers.map((h, i) => (
              <div key={i} className={http.headerRow}>
                <Input placeholder="Header" value={h.key} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                {h.secretRef ? (
                  <Select value={h.secretRef} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, secretRef: e.target.value } : r)))}>
                    {secrets.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.maskedHint})</option>
                    ))}
                  </Select>
                ) : (
                  <Input placeholder="Value" value={h.value} onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
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
              <Button variant="ghost" size="sm" onClick={addSecret}>+ Store a secret</Button>
            </div>
          </div>
        </Field>

        {nonGet && (
          <Field label="Request body" hint="JSON with {{column}} references.">
            <PromptEditor value={body} onChange={setBody} columns={columns} />
          </Field>
        )}

        <Field label="Response value" hint="JSON path into the response for this column, e.g. data.city or $ for the whole body.">
          <Input value={responsePath} onChange={(e) => setResponsePath(e.target.value)} placeholder="data.city" />
        </Field>

        <Field label="Map extra fields to columns">
          <div className={http.rows}>
            {maps.map((m, i) => (
              <div key={m.key} className={http.mapRow}>
                <Input placeholder="Field" value={m.field} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))} />
                <Input placeholder="JSON path" value={m.path} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)))} />
                <Select value={m.destColumnId} onChange={(e) => setMaps((rows) => rows.map((r, j) => (j === i ? { ...r, destColumnId: e.target.value } : r)))}>
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
