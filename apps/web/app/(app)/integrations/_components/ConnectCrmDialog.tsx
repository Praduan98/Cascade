'use client'
// Connect-CRM dialog (US-3.12): provider + account + write-only token + the
// table to sync + an initial field mapping and dedupe key. The token is sent
// once and never returned — the API stores only a masked hint.

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { CrmProvider, TableMeta } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import { MappingEditor, type MappingRow } from './MappingEditor'
import styles from '../integrations.module.css'

const CRM_LABEL: Record<CrmProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
}

export interface ConnectCrmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  tables: TableMeta[]
  onConnected: () => void
}

export function ConnectCrmDialog({ open, onOpenChange, workspaceId, tables, onConnected }: ConnectCrmDialogProps) {
  const { toast } = useToast()
  const [provider, setProvider] = useState<CrmProvider>('hubspot')
  const [accountLabel, setAccountLabel] = useState('')
  const [token, setToken] = useState('')
  const [tableId, setTableId] = useState('')
  const [rows, setRows] = useState<MappingRow[]>([{ crmField: '', columnId: '' }])
  const [dedupeColumnId, setDedupeColumnId] = useState('')

  // Seed a default table when the dialog opens.
  useEffect(() => {
    if (open && !tableId && tables.length > 0) setTableId(tables[0]?.id ?? '')
  }, [open, tableId, tables])

  const columnsQuery = useQuery({
    queryKey: ['columns', tableId],
    queryFn: () => getApi().columns.list(tableId),
    enabled: open && !!tableId,
  })
  const columns = columnsQuery.data ?? []

  function reset() {
    setProvider('hubspot')
    setAccountLabel('')
    setToken('')
    setTableId('')
    setRows([{ crmField: '', columnId: '' }])
    setDedupeColumnId('')
  }

  const connect = useMutation({
    mutationFn: () => {
      const fieldMapping: Record<string, string> = {}
      for (const r of rows) {
        const f = r.crmField.trim()
        if (f && r.columnId) fieldMapping[f] = r.columnId
      }
      return getApi().integration.crm.connect(workspaceId, {
        provider,
        token: token.trim(),
        accountLabel: accountLabel.trim(),
        tableId,
        fieldMapping,
        dedupeColumnId: dedupeColumnId || undefined,
      })
    },
    onSuccess: () => {
      toast(`Connected ${CRM_LABEL[provider]}`, { variant: 'success' })
      onConnected()
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast(errorMessage(e, 'Could not connect the CRM'), { variant: 'error' }),
  })

  const canSubmit = !!token.trim() && !!tableId && !connect.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="Connect a CRM"
      description="Sync a table with HubSpot, Salesforce, or Pipedrive. The API token is stored securely and never shown again."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => connect.mutate()} disabled={!canSubmit}>
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <Field label="Provider" htmlFor="crm-provider">
          <Select id="crm-provider" value={provider} onChange={(e) => setProvider(e.target.value as CrmProvider)}>
            <option value="hubspot">HubSpot</option>
            <option value="salesforce">Salesforce</option>
            <option value="pipedrive">Pipedrive</option>
          </Select>
        </Field>
        <Field label="Account label" htmlFor="crm-account" hint="A name to recognise this connection.">
          <Input
            id="crm-account"
            placeholder="Acme (hub-1234)"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
          />
        </Field>
      </div>

      <Field label="API token" htmlFor="crm-token" hint="Stored securely and never shown again.">
        <Input
          id="crm-token"
          type="password"
          autoComplete="off"
          placeholder="Paste the CRM API token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>

      <Field label="Table to sync" htmlFor="crm-table">
        <Select
          id="crm-table"
          value={tableId}
          onChange={(e) => {
            setTableId(e.target.value)
            setDedupeColumnId('')
            setRows([{ crmField: '', columnId: '' }])
          }}
        >
          {tables.length === 0 && <option value="">No tables in this workspace</option>}
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Field mapping" hint="Map CRM fields to table columns for push and pull.">
        <div>
          <MappingEditor rows={rows} columns={columns} onChange={setRows} loading={columnsQuery.isLoading} />
        </div>
      </Field>

      <Field label="Dedupe column" htmlFor="crm-dedupe" hint="Key used to match records (e.g. email or domain).">
        <Select
          id="crm-dedupe"
          value={dedupeColumnId}
          disabled={columnsQuery.isLoading}
          onChange={(e) => setDedupeColumnId(e.target.value)}
        >
          <option value="">No dedupe key</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}
