'use client'
// The AI column authoring dialog — the Phase-3 analog of WaterfallBuilder. Pick
// a model, write a prompt referencing other columns, optionally define a typed
// output schema that fans out to columns, and save. Creating the anchor column
// (and any "create column" schema targets) happens here on save, so a member can
// go from nothing to a running AI column in one flow.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { AiModel, AiOperation, AiOutputField, Column } from '@cascade/core'
import { defaultConfigFor } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, ProvMono, Seg, Select, Switch, Tag, useToast } from '@cascade/ui'
import type { SegOption } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { AI_OPERATIONS } from './aiMeta'
import { PromptEditor } from './PromptEditor'
import { cleanFields, newField, NEW_COLUMN, SchemaFieldsEditor } from './SchemaFieldsEditor'
import type { DraftField } from './SchemaFieldsEditor'
import styles from './ai-column.module.css'

const TTL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
]

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: Column[]
  workspaceId: string
  /** Existing AI column when editing; null to create a new one. */
  column: Column | null
  /** Prefill the new-column name (from the Add-column handoff). */
  seedName?: string
  onSaved: () => void
}

export function AiColumnBuilder({ open, onOpenChange, tableId, columns, workspaceId, column, seedName, onSaved }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [newName, setNewName] = useState('')
  const [modelId, setModelId] = useState('')
  const [operation, setOperation] = useState<AiOperation>('summarize')
  const [prompt, setPrompt] = useState('')
  const [structured, setStructured] = useState(false)
  const [fields, setFields] = useState<DraftField[]>([])
  const [cacheTtlDays, setCacheTtlDays] = useState(30)
  const [autoRun, setAutoRun] = useState(false)

  const modelsQuery = useQuery({
    queryKey: ['ai', 'models', workspaceId],
    queryFn: () => getApi().ai.models.list(workspaceId),
    enabled: open,
  })
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])

  const configQuery = useQuery({
    queryKey: ['ai', 'config', column?.id],
    queryFn: () => getApi().ai.configs.get(column!.id),
    enabled: open && !!column,
  })

  // Seed the model default once models load.
  useEffect(() => {
    if (!open || modelId || models.length === 0) return
    const def = models.find((m) => m.isDefault) ?? models[0]
    if (def) setModelId(def.model)
  }, [open, models, modelId])

  // Reset / seed drafts when the dialog opens.
  useEffect(() => {
    if (!open) return
    setNewName(seedName ?? '')
    const cfg = configQuery.data
    if (cfg) {
      setModelId(cfg.model.model)
      setOperation(cfg.operation)
      setPrompt(cfg.promptTemplate)
      setStructured(cfg.outputSchema.length > 0)
      setFields(
        cfg.outputSchema.map((f, i) => ({
          key: `f_seed_${i}`,
          name: f.name,
          type: f.type,
          destColumnId: cfg.outputMapping[f.name] ?? NEW_COLUMN,
        })),
      )
      setCacheTtlDays(cfg.cacheTtlDays)
      setAutoRun(cfg.autoRun)
    } else if (!column) {
      setOperation('summarize')
      setPrompt('')
      setStructured(false)
      setFields([])
      setCacheTtlDays(30)
      setAutoRun(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configQuery.data, column, seedName])

  // Seed the schema with one empty field the first time structured output is on.
  useEffect(() => {
    if (structured && fields.length === 0) setFields([newField()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structured])

  const modelInfo = models.find((m) => m.model === modelId)
  const perRow = modelInfo?.credits ?? 1

  const modelOptions: SegOption<string>[] = models.map((m) => ({
    value: m.model,
    label: (
      <span className={styles.modelOption}>
        <ProvMono bg={m.monoColor}>{m.glyph}</ProvMono>
        {m.label}
      </span>
    ),
  }))

  const save = useMutation({
    mutationFn: async () => {
      const api = getApi()
      // 1) Resolve or create the anchor AI column.
      let anchorId = column?.id
      if (!anchorId) {
        const created = await api.columns.add(tableId, { name: newName.trim(), type: 'ai', config: { type: 'ai' } })
        anchorId = created.id
      }
      // 2) Build the output schema + mapping, creating "create column" targets.
      const outputSchema: AiOutputField[] = []
      const outputMapping: Record<string, string> = {}
      if (structured) {
        for (const f of cleanFields(fields)) {
          outputSchema.push({ name: f.name, type: f.type })
          let destId = f.destColumnId
          if (destId === NEW_COLUMN) {
            const created = await api.columns.add(tableId, { name: f.name, type: f.type, config: defaultConfigFor(f.type) })
            destId = created.id
          }
          outputMapping[f.name] = destId
        }
      }
      const model: AiModel = { provider: modelInfo?.provider ?? 'anthropic', model: modelId }
      return api.ai.configs.upsert({
        columnId: anchorId,
        model,
        operation,
        promptTemplate: prompt.trim(),
        outputSchema,
        outputMapping,
        cacheTtlDays,
        autoRun,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      void qc.invalidateQueries({ queryKey: ['ai', 'configs', tableId] })
      if (column) void qc.invalidateQueries({ queryKey: ['ai', 'config', column.id] })
      toast('AI column saved', { variant: 'success' })
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the AI column'), { variant: 'error' }),
  })

  function validateAndSave() {
    if (!column && newName.trim() === '') {
      toast('Name the AI column', { variant: 'warn' })
      return
    }
    if (prompt.trim() === '') {
      toast('Write a prompt for the AI column', { variant: 'warn' })
      return
    }
    if (structured && cleanFields(fields).length === 0) {
      toast('Add at least one output field, or turn off structured output', { variant: 'warn' })
      return
    }
    save.mutate()
  }

  const opHint = AI_OPERATIONS.find((o) => o.value === operation)?.hint

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI column"
      description="Write a prompt that references other columns. It runs per row on the shared status machine — cached and missing-input rows are free."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={validateAndSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save AI column'}
          </Button>
        </>
      }
    >
      <div className={styles.builder}>
        <div className={styles.builderHead}>
          {column ? (
            <span className={styles.anchorName}>{column.name}</span>
          ) : (
            <Field label="Column name" htmlFor="ai-col-name">
              <Input id="ai-col-name" autoFocus placeholder="e.g. AI: One-line pitch" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}
          <Tag mono tone="gold" className={styles.estTag}>
            est. ≤ {perRow} cr/row
          </Tag>
        </div>

        <Field label="Model">
          <div className={styles.modelSeg}>
            <Seg options={modelOptions} value={modelId} onChange={setModelId} aria-label="Model" />
          </div>
        </Field>

        <Field label="Task">
          <Select value={operation} onChange={(e) => setOperation(e.target.value as AiOperation)}>
            {AI_OPERATIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {opHint && <div className={styles.modelHint}>{opHint}</div>}
        </Field>

        <Field label="Prompt" hint="Insert {{column}} references; they're substituted per row.">
          <PromptEditor value={prompt} onChange={setPrompt} columns={columns} />
        </Field>

        <div>
          <div className={styles.switchRow}>
            <span className={styles.lbl}>Structured output — return multiple typed fields</span>
            <Switch checked={structured} onCheckedChange={setStructured} aria-label="Structured output" />
          </div>
          {structured && (
            <>
              <SchemaFieldsEditor fields={fields} columns={columns} onChange={setFields} />
              {cleanFields(fields).length > 0 && (
                <div className={styles.createsLine}>
                  Populates {cleanFields(fields).length} field{cleanFields(fields).length > 1 ? 's' : ''} · {cleanFields(fields).map((f) => f.name).join(', ')}
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.row2}>
          <Field label="Cache results">
            <Select value={String(cacheTtlDays)} onChange={(e) => setCacheTtlDays(Number(e.target.value))}>
              {TTL_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
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
