'use client'
// Add a new column: pick from the 11 types, name it, and configure per-type
// options (select choices with label + colour, number/currency precision, date
// format). Persists through getApi().columns.add.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { defaultConfigFor } from '@cascade/core'
import type { ColumnConfig, ColumnType, MultiSelectConfig, SingleSelectConfig } from '@cascade/core'
import { Alert, Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../lib/ui'
import { TypePicker } from './TypePicker'
import { ColumnConfigFields, cleanOptions } from './ColumnConfigFields'

/** Operation column types that hand off to a dedicated builder instead of a plain add. */
const SMART_TYPES = new Set<ColumnType>(['ai', 'agent', 'http', 'formula'])
const SMART_COPY: Record<string, { cta: string; note: string }> = {
  ai: { cta: 'Configure AI…', note: 'AI columns use a prompt and a model. Name the column, then continue to the AI builder.' },
  agent: { cta: 'Configure agent…', note: 'Agent columns research the web per row and cite their sources. Name the column, then continue to the agent builder.' },
  http: { cta: 'Configure HTTP…', note: 'HTTP columns call an external API and map a value out of the response. Name the column, then continue to the HTTP builder.' },
  formula: { cta: 'Configure formula…', note: 'Formula columns compute a value from other columns. Name the column, then continue to the formula builder.' },
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  onAdded: () => void
  /** Selecting a smart type (ai/agent/http/formula) hands off to its builder. */
  onRequestSmartColumn?: (type: ColumnType, seedName: string) => void
}

export function AddColumnDialog({ open, onOpenChange, tableId, onAdded, onRequestSmartColumn }: Props) {
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

  const isSmart = SMART_TYPES.has(type)
  const canSubmit = isSmart ? !mutation.isPending : name.trim().length > 0 && !mutation.isPending

  function handleSmartHandoff() {
    onOpenChange(false)
    // Wait a tick so the two Radix focus traps never collide.
    setTimeout(() => onRequestSmartColumn?.(type, name.trim()), 0)
  }

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
          {isSmart ? (
            <Button variant="primary" onClick={handleSmartHandoff}>
              {SMART_COPY[type]?.cta ?? 'Configure…'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} disabled={!canSubmit}>
              {mutation.isPending ? 'Adding…' : 'Add column'}
            </Button>
          )}
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
              if (isSmart) handleSmartHandoff()
              else if (canSubmit) mutation.mutate()
            }
          }}
        />
      </Field>
      {isSmart ? (
        <Alert variant="info">{SMART_COPY[type]?.note}</Alert>
      ) : (
        <ColumnConfigFields type={type} value={config} onChange={setConfig} />
      )}
    </Dialog>
  )
}
