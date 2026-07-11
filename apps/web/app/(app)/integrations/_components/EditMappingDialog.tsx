'use client'
// Edit-mapping dialog: change an existing CRM connection's field mapping (CRM
// field → column) and its dedupe key. Columns come from the connection's table.

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { CrmConnection } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Select, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import { MappingEditor, type MappingRow } from './MappingEditor'
import styles from '../integrations.module.css'

export interface EditMappingDialogProps {
  connection: CrmConnection
  workspaceId: string
  onClose: () => void
  onSaved: () => void
}

export function EditMappingDialog({ connection, workspaceId, onClose, onSaved }: EditMappingDialogProps) {
  const { toast } = useToast()
  const [rows, setRows] = useState<MappingRow[]>(() => {
    const entries = Object.entries(connection.fieldMapping)
    return entries.length > 0
      ? entries.map(([crmField, columnId]) => ({ crmField, columnId }))
      : [{ crmField: '', columnId: '' }]
  })
  const [dedupeColumnId, setDedupeColumnId] = useState(connection.dedupeColumnId ?? '')

  const columnsQuery = useQuery({
    queryKey: ['columns', connection.tableId],
    queryFn: () => getApi().columns.list(connection.tableId),
  })
  const columns = columnsQuery.data ?? []

  const save = useMutation({
    mutationFn: () => {
      const fieldMapping: Record<string, string> = {}
      for (const r of rows) {
        const f = r.crmField.trim()
        if (f && r.columnId) fieldMapping[f] = r.columnId
      }
      return getApi().integration.crm.updateMapping(workspaceId, connection.id, {
        fieldMapping,
        dedupeColumnId,
      })
    },
    onSuccess: () => {
      toast('Mapping updated', { variant: 'success' })
      onSaved()
      onClose()
    },
    onError: (e) => toast(errorMessage(e, 'Could not update the mapping'), { variant: 'error' }),
  })

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="Edit field mapping"
      description={`${connection.accountLabel} · map CRM fields to columns and choose the dedupe key.`}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save mapping'}
          </Button>
        </>
      }
    >
      <div role="group" aria-labelledby="edit-map-label" aria-describedby="edit-map-hint" className={styles.group}>
        <span id="edit-map-label" className={styles.groupLabel}>
          Field mapping
        </span>
        <MappingEditor rows={rows} columns={columns} onChange={setRows} loading={columnsQuery.isLoading} />
        <span id="edit-map-hint" className={styles.groupHint}>
          CRM field → table column.
        </span>
      </div>

      <Field label="Dedupe column" htmlFor="edit-dedupe" hint="Key used to match records on sync.">
        <Select
          id="edit-dedupe"
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
