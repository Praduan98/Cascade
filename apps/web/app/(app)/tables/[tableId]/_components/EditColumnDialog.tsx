'use client'
// Edit an existing column: rename, change its type, and adjust per-type config.
// When the new type/config would not fit existing values, a live coercion
// warning (computed with core's coerceColumnValue over a sample of rows) tells
// the user how many values will be cleared before they commit. Changing the
// type persists through columns.retype (which coerces every cell server-side);
// name/config-only edits go through columns.update.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { coerceColumnValue, defaultConfigFor, getColumnType } from '@cascade/core'
import type { Column, ColumnConfig, ColumnType, MultiSelectConfig, SingleSelectConfig } from '@cascade/core'
import { Alert, Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../lib/ui'
import { TypePicker } from './TypePicker'
import { ColumnConfigFields, cleanOptions } from './ColumnConfigFields'
import styles from '../column-tools.module.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  column: Column | null
  onChanged: () => void
}

const SAMPLE_LIMIT = 300

function normalizeConfig(type: ColumnType, config: ColumnConfig): ColumnConfig {
  if (type === 'singleSelect' || type === 'multiSelect') {
    return { type, options: cleanOptions((config as SingleSelectConfig | MultiSelectConfig).options) } as
      | SingleSelectConfig
      | MultiSelectConfig
  }
  return config
}

export function EditColumnDialog({ open, onOpenChange, tableId, column, onChanged }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState<ColumnType>('text')
  const [config, setConfig] = useState<ColumnConfig>(() => defaultConfigFor('text'))

  useEffect(() => {
    if (column) {
      setName(column.name)
      setType(column.type)
      setConfig(column.config)
    }
  }, [column])

  function changeType(next: ColumnType) {
    setType(next)
    // Preserve existing config when the type is unchanged; otherwise default it.
    setConfig(column && next === column.type ? column.config : defaultConfigFor(next))
  }

  // A sample of the column's current values, used only to estimate coercion loss.
  const sampleQuery = useQuery({
    queryKey: ['coerce-sample', tableId, column?.id],
    queryFn: () => getApi().records.list(tableId, { limit: SAMPLE_LIMIT }),
    enabled: open && !!column,
    staleTime: 5_000,
  })

  const typeChanged = !!column && type !== column.type
  const configChanged = !!column && JSON.stringify(config) !== JSON.stringify(column.config)
  const nameChanged = !!column && name.trim() !== column.name

  const coercion = useMemo(() => {
    if (!column || (!typeChanged && !configChanged)) return null
    const rows = sampleQuery.data?.rows
    if (!rows) return null
    const to: Column = { ...column, type, config: normalizeConfig(type, config) }
    let nonEmpty = 0
    let lossy = 0
    for (const r of rows) {
      const value = r.cells[column.id]?.value ?? null
      if (getColumnType(column.type).isEmpty(value)) continue
      nonEmpty += 1
      if (coerceColumnValue(column, to, value).lossy) lossy += 1
    }
    return { sampled: rows.length, nonEmpty, lossy, capped: rows.length >= SAMPLE_LIMIT }
  }, [column, type, config, typeChanged, configChanged, sampleQuery.data])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!column) return { label: '', lost: 0 }
      const finalConfig = normalizeConfig(type, config)
      let lost = 0
      if (typeChanged) {
        const res = await getApi().columns.retype(column.id, type, finalConfig)
        lost = res.lost
        if (nameChanged) await getApi().columns.update(column.id, { name: name.trim() })
      } else if (nameChanged || configChanged) {
        await getApi().columns.update(column.id, {
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(configChanged ? { config: finalConfig } : {}),
        })
      }
      return { label: getColumnType(type).label, lost }
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      const msg = typeChanged
        ? res.lost > 0
          ? `Converted to ${res.label} — cleared ${res.lost} value${res.lost === 1 ? '' : 's'} that didn’t fit`
          : `Converted to ${res.label}`
        : 'Column updated'
      toast(msg, { variant: res.lost > 0 ? 'warn' : 'success' })
      onChanged()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not update column'), { variant: 'error' }),
  })

  const dirty = nameChanged || typeChanged || configChanged
  const canSubmit = !!column && name.trim().length > 0 && dirty && !mutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit column"
      description={column ? `Update “${column.name}”.` : undefined}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Field label="Column name" htmlFor="edit-col-name">
        <Input
          id="edit-col-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Type">
        <TypePicker value={type} onChange={changeType} />
      </Field>
      <ColumnConfigFields type={type} value={config} onChange={setConfig} />
      {coercion && coercion.lossy > 0 && (
        <Alert variant="warn" title="This change may clear some values" className={styles.warnBox}>
          {`${coercion.lossy} of ${coercion.nonEmpty} filled value${coercion.nonEmpty === 1 ? '' : 's'} in ${
            coercion.capped ? 'the sampled rows' : 'this table'
          } don’t fit the new type and will be cleared.`}
        </Alert>
      )}
    </Dialog>
  )
}
