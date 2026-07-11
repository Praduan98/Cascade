'use client'
// The web-research agent column authoring dialog (US-3.3/3.4) — a close analog
// of AiColumnBuilder. Pick a model, write a research objective referencing other
// columns, cap the browse (steps/pages), optionally define a typed output schema,
// and save. The agent cites the sources it "visits" in the provenance card.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { AiModel, AiOutputField, Column } from '@cascade/core'
import { defaultConfigFor } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, ProvMono, Seg, Select, Switch, Tag, useToast } from '@cascade/ui'
import type { SegOption } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { PromptEditor } from '../ai/PromptEditor'
import { cleanFields, newField, NEW_COLUMN, SchemaFieldsEditor } from '../ai/SchemaFieldsEditor'
import type { DraftField } from '../ai/SchemaFieldsEditor'
import styles from '../ai/ai-column.module.css'

const TTL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]
const STEP_OPTIONS = [3, 5, 8, 12]
const PAGE_OPTIONS = [2, 4, 6, 10]

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

export function AgentColumnBuilder({ open, onOpenChange, tableId, columns, workspaceId, column, seedName, onSaved }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [newName, setNewName] = useState('')
  const [modelId, setModelId] = useState('')
  const [objective, setObjective] = useState('')
  const [maxSteps, setMaxSteps] = useState(5)
  const [maxPages, setMaxPages] = useState(4)
  const [structured, setStructured] = useState(false)
  const [fields, setFields] = useState<DraftField[]>([])
  const [cacheTtlDays, setCacheTtlDays] = useState(30)
  const [autoRun, setAutoRun] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const modelsQuery = useQuery({
    queryKey: ['agent', 'models', workspaceId],
    queryFn: () => getApi().agent.models.list(workspaceId),
    enabled: open,
  })
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])

  const configQuery = useQuery({
    queryKey: ['agent', 'config', column?.id],
    queryFn: () => getApi().agent.configs.get(column!.id),
    enabled: open && !!column,
  })

  useEffect(() => {
    if (!open || modelId || models.length === 0) return
    const def = models.find((m) => m.isDefault) ?? models[0]
    if (def) setModelId(def.model)
  }, [open, models, modelId])

  useEffect(() => {
    if (!open) return
    setAttempted(false)
    setNewName(seedName ?? '')
    const cfg = configQuery.data
    if (cfg) {
      setModelId(cfg.model.model)
      setObjective(cfg.objective)
      setMaxSteps(cfg.maxSteps)
      setMaxPages(cfg.maxPages)
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
      setObjective('')
      setMaxSteps(5)
      setMaxPages(4)
      setStructured(false)
      setFields([])
      setCacheTtlDays(30)
      setAutoRun(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configQuery.data, column, seedName])

  useEffect(() => {
    if (structured && fields.length === 0) setFields([newField()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structured])

  const modelInfo = models.find((m) => m.model === modelId)
  const perRow = (modelInfo?.credits ?? 1) * 2

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
      let anchorId = column?.id
      if (!anchorId) {
        const created = await api.columns.add(tableId, { name: newName.trim(), type: 'agent', config: { type: 'agent' } })
        anchorId = created.id
      }
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
      return api.agent.configs.upsert({
        columnId: anchorId,
        model,
        objective: objective.trim(),
        outputSchema,
        outputMapping,
        maxSteps,
        maxPages,
        cacheTtlDays,
        autoRun,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      void qc.invalidateQueries({ queryKey: ['agent', 'configs', tableId] })
      if (column) void qc.invalidateQueries({ queryKey: ['agent', 'config', column.id] })
      toast('Agent column saved', { variant: 'success' })
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the agent column'), { variant: 'error' }),
  })

  const nameError = !column && newName.trim() === '' ? 'Name the agent column' : null
  const objectiveError = objective.trim() === '' ? 'Write a research objective' : null
  const structuredError = structured && cleanFields(fields).length === 0 ? 'Add at least one output field, or turn off structured output' : null

  function validateAndSave() {
    setAttempted(true)
    if (nameError || objectiveError || structuredError) return
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Web-research agent column"
      description="Describe what to research per row. The agent browses up to the page cap, cites its sources, and runs on the shared status machine — cached and missing-input rows are free."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={validateAndSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save agent column'}
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
              htmlFor="agent-col-name"
              hint={attempted && nameError ? nameError : undefined}
              error={attempted && !!nameError}
            >
              <Input id="agent-col-name" autoFocus placeholder="e.g. Agent: Company intel" value={newName} onChange={(e) => setNewName(e.target.value)} />
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

        <Field
          label="Research objective (required)"
          hint={attempted && objectiveError ? objectiveError : "Insert {{column}} references; they're substituted per row."}
          error={attempted && !!objectiveError}
        >
          <PromptEditor label="Research objective" value={objective} onChange={setObjective} columns={columns} />
        </Field>

        <div className={styles.row2}>
          <Field label="Max steps" hint="Reasoning + browse steps per row.">
            <Select value={String(maxSteps)} onChange={(e) => setMaxSteps(Number(e.target.value))}>
              {STEP_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} steps</option>
              ))}
            </Select>
          </Field>
          <Field label="Max pages" hint="Pages fetched per row (bounds cost).">
            <Select value={String(maxPages)} onChange={(e) => setMaxPages(Number(e.target.value))}>
              {PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} pages</option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className={styles.switchRow}>
            <span className={styles.lbl}>Structured output — return multiple typed fields</span>
            <Switch checked={structured} onCheckedChange={setStructured} aria-label="Structured output" />
          </div>
          {structured && (
            <>
              <SchemaFieldsEditor fields={fields} columns={columns} onChange={setFields} />
              {attempted && structuredError ? (
                <span className={styles.reqError} role="alert">{structuredError}</span>
              ) : cleanFields(fields).length > 0 ? (
                <div className={styles.createsLine}>
                  Populates {cleanFields(fields).length} field{cleanFields(fields).length > 1 ? 's' : ''} · {cleanFields(fields).map((f) => f.name).join(', ')}
                </div>
              ) : null}
            </>
          )}
        </div>

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
