'use client'
// Add a new column: pick from the 11 types, name it, and configure per-type
// options (select choices with label + colour, number/currency precision, date
// format). Persists through getApi().columns.add.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { defaultConfigFor } from '@cascade/core'
import type { ColumnConfig, ColumnType, MultiSelectConfig, SingleSelectConfig } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../lib/ui'
import { TypePicker } from './TypePicker'
import { ColumnConfigFields, cleanOptions } from './ColumnConfigFields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  onAdded: () => void
}

export function AddColumnDialog({ open, onOpenChange, tableId, onAdded }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState<ColumnType>('text')
  const [config, setConfig] = useState<ColumnConfig>(() => defaultConfigFor('text'))

  useEffect(() => {
    if (open) {
      setName('')
      setType('text')
      setConfig(defaultConfigFor('text'))
    }
  }, [open])

  function changeType(next: ColumnType) {
    setType(next)
    setConfig(defaultConfigFor(next))
  }

  const mutation = useMutation({
    mutationFn: () => {
      let finalConfig = config
      if (type === 'singleSelect' || type === 'multiSelect') {
        const opts = cleanOptions((config as SingleSelectConfig | MultiSelectConfig).options)
        finalConfig = { type, options: opts } as SingleSelectConfig | MultiSelectConfig
      }
      return getApi().columns.add(tableId, { name: name.trim(), type, config: finalConfig })
    },
    onSuccess: (col) => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      toast(`Added column “${col.name}”`, { variant: 'success' })
      onAdded()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not add column'), { variant: 'error' }),
  })

  const canSubmit = name.trim().length > 0 && !mutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add column"
      description="Choose a type, name the column, and configure how it behaves."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? 'Adding…' : 'Add column'}
          </Button>
        </>
      }
    >
      <Field label="Type">
        <TypePicker value={type} onChange={changeType} />
      </Field>
      <Field label="Column name" htmlFor="add-col-name">
        <Input
          id="add-col-name"
          autoFocus
          placeholder="e.g. Status"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (canSubmit) mutation.mutate()
            }
          }}
        />
      </Field>
      <ColumnConfigFields type={type} value={config} onChange={setConfig} />
    </Dialog>
  )
}
