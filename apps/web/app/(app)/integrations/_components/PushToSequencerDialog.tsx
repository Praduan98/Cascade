'use client'
// Push-to-sequencer dialog (US-4.10): pick a table + campaign, map columns to
// the sequencer's contact fields (email is REQUIRED — the API rejects a push
// with no email mapping), and optionally filter which rows go (e.g. only rows
// whose verified-deliverable column is not empty). The push reports
// created/failed/skipped, surfaced in a toast + the push-history table.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { SequencerPushFilter } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, Switch, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import styles from '../integrations.module.css'

// The sequencer contact fields we can map a table column onto. `email` is
// required — the mock API detects it by the field name containing "email".
const SEQ_FIELDS: { field: string; label: string; required?: boolean }[] = [
  { field: 'email', label: 'Email', required: true },
  { field: 'first_name', label: 'First name' },
  { field: 'last_name', label: 'Last name' },
  { field: 'company', label: 'Company' },
]

type FilterOp = 'notEmpty' | 'equals'

export function PushToSequencerDialog(props: {
  open: boolean
  onOpenChange: (o: boolean) => void
  workspaceId: string
  connectionId: string
  onPushed: () => void
}) {
  const { open, onOpenChange, workspaceId, connectionId, onPushed } = props
  const { toast } = useToast()

  const [tableId, setTableId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  // sequencer field → table columnId (inverted to columnId → field on submit).
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [filterColumnId, setFilterColumnId] = useState('')
  const [filterOp, setFilterOp] = useState<FilterOp>('notEmpty')
  const [filterValue, setFilterValue] = useState('')

  const tablesQuery = useQuery({
    queryKey: ['tables', workspaceId],
    queryFn: () => getApi().tables.list(workspaceId),
    enabled: open,
  })
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])

  const columnsQuery = useQuery({
    queryKey: ['columns', tableId],
    queryFn: () => getApi().columns.list(tableId),
    enabled: open && !!tableId,
  })
  const columns = columnsQuery.data ?? []

  const campaignsQuery = useQuery({
    queryKey: ['integration', 'sequencers', 'campaigns', workspaceId, connectionId],
    queryFn: () => getApi().integration.sequencers.campaigns(workspaceId, connectionId),
    enabled: open && !!connectionId,
  })
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data])

  // Seed a default table + campaign once each list loads.
  useEffect(() => {
    if (open && !tableId && tables.length > 0) setTableId(tables[0]?.id ?? '')
  }, [open, tableId, tables])
  useEffect(() => {
    if (open && !campaignId && campaigns.length > 0) setCampaignId(campaigns[0]?.id ?? '')
  }, [open, campaignId, campaigns])

  function reset() {
    setTableId('')
    setCampaignId('')
    setMapping({})
    setFilterEnabled(false)
    setFilterColumnId('')
    setFilterOp('notEmpty')
    setFilterValue('')
  }

  const push = useMutation({
    mutationFn: () => {
      // Invert to the API shape: table columnId → sequencer field.
      const fieldMapping: Record<string, string> = {}
      for (const { field } of SEQ_FIELDS) {
        const colId = mapping[field]
        if (colId) fieldMapping[colId] = field
      }
      const filter: SequencerPushFilter | undefined =
        filterEnabled && filterColumnId
          ? {
              columnId: filterColumnId,
              op: filterOp,
              value: filterOp === 'equals' ? filterValue.trim() : undefined,
            }
          : undefined
      const campaignName = campaigns.find((c) => c.id === campaignId)?.name ?? ''
      return getApi().integration.sequencers.push(workspaceId, connectionId, {
        tableId,
        campaignId,
        campaignName,
        fieldMapping,
        filter,
      })
    },
    onSuccess: (run) => {
      toast(
        `Pushed to ${run.campaignName}: ${run.created} added, ${run.skipped} skipped${run.failed ? `, ${run.failed} failed` : ''}`,
        { variant: run.failed > 0 ? 'warn' : 'success' },
      )
      onPushed()
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast(errorMessage(e, 'The push failed'), { variant: 'error' }),
  })

  const canSubmit = !!tableId && !!campaignId && !!mapping.email && !push.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="Push list to a campaign"
      description="Map your table columns to the sequencer’s contact fields and push. Email is required; unmapped or empty rows are skipped."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => push.mutate()} disabled={!canSubmit}>
            {push.isPending ? 'Pushing…' : 'Push list'}
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <Field label="Table" htmlFor="seq-table">
          <Select
            id="seq-table"
            value={tableId}
            onChange={(e) => {
              setTableId(e.target.value)
              setMapping({})
              setFilterColumnId('')
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
        <Field label="Campaign" htmlFor="seq-campaign">
          <Select
            id="seq-campaign"
            value={campaignId}
            disabled={campaignsQuery.isLoading}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            {campaigns.length === 0 && <option value="">No campaigns available</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.contactCount} contacts
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Field mapping"
        hint="Map columns to the sequencer’s contact fields. Email is required."
      >
        <div className={styles.formGrid}>
          {SEQ_FIELDS.map(({ field, label, required }) => (
            <Field key={field} label={required ? `${label} (required)` : label} htmlFor={`seq-map-${field}`}>
              <Select
                id={`seq-map-${field}`}
                value={mapping[field] ?? ''}
                disabled={columnsQuery.isLoading || !tableId}
                onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
              >
                <option value="">Select column…</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      </Field>

      <Field label="Filter rows" hint="Optionally push only rows meeting a condition (e.g. a verified-deliverable email).">
        <div>
          <div className={styles.filterToggle}>
            <Switch
              id="seq-filter"
              checked={filterEnabled}
              onCheckedChange={setFilterEnabled}
              aria-label="Only push rows matching a condition"
            />
            <label htmlFor="seq-filter">Only push rows matching a condition</label>
          </div>
          {filterEnabled && (
            <div className={[styles.formGrid, styles.filterFields].join(' ')}>
              <Field label="Column" htmlFor="seq-filter-col">
                <Select
                  id="seq-filter-col"
                  value={filterColumnId}
                  disabled={columnsQuery.isLoading || !tableId}
                  onChange={(e) => setFilterColumnId(e.target.value)}
                >
                  <option value="">Select column…</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Condition" htmlFor="seq-filter-op">
                <Select
                  id="seq-filter-op"
                  value={filterOp}
                  onChange={(e) => setFilterOp(e.target.value as FilterOp)}
                >
                  <option value="notEmpty">is not empty</option>
                  <option value="equals">equals</option>
                </Select>
              </Field>
              {filterOp === 'equals' && (
                <Field label="Value" htmlFor="seq-filter-value">
                  <Input
                    id="seq-filter-value"
                    placeholder="e.g. Deliverable"
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                  />
                </Field>
              )}
            </div>
          )}
        </div>
      </Field>
    </Dialog>
  )
}
