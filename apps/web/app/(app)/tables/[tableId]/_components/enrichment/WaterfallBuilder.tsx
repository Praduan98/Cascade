'use client'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { AcceptanceCondition, Column, EnrichmentOperation, EnrichmentStep, Provider } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, Switch, Tag, TrashIcon, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { ACCEPTANCE_LABEL, OP_META, providerOperations } from './opMeta'
import styles from './enrichment.module.css'

interface DraftStep {
  key: string
  providerId: string
  operation: EnrichmentOperation
  inputMapping: Record<string, string>
  outputMapping: Record<string, string>
  acceptanceCondition: AcceptanceCondition
  acceptField?: string
  minConfidence?: number
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: Column[]
  workspaceId: string
  /** Anchor column when editing an existing waterfall; null to pick one. */
  column: Column | null
  onSaved: () => void
}

let keySeq = 0
const nextKey = () => `st_${keySeq++}`

function MoveUp() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
}
function MoveDown() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}

export function WaterfallBuilder({ open, onOpenChange, tableId, columns, workspaceId, column, onSaved }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [anchorId, setAnchorId] = useState(column?.id ?? columns[0]?.id ?? '')
  const [steps, setSteps] = useState<DraftStep[]>([])
  const [autoRun, setAutoRun] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const providersQuery = useQuery({
    queryKey: ['enrichment', 'providers', workspaceId],
    queryFn: () => getApi().enrichment.providers.list(workspaceId),
    enabled: open,
  })
  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data])

  const configQuery = useQuery({
    queryKey: ['enrichment', 'config', anchorId],
    queryFn: () => getApi().enrichment.configs.get(anchorId),
    enabled: open && !!anchorId,
  })

  // Seed drafts from the existing config (or start empty) when it loads.
  useEffect(() => {
    if (!open) return
    setAttempted(false)
    const cfg = configQuery.data
    if (cfg) {
      setSteps(cfg.steps.map((s) => ({ key: nextKey(), ...s })))
      setAutoRun(cfg.autoRun)
    } else if (configQuery.isFetched) {
      setSteps([])
      setAutoRun(false)
    }
  }, [open, configQuery.data, configQuery.isFetched])

  useEffect(() => {
    if (open) setAnchorId(column?.id ?? columns[0]?.id ?? '')
  }, [open, column, columns])

  function creditsFor(providerId: string, op: EnrichmentOperation): number {
    return providers.find((p) => p.id === providerId)?.costConfig[op]?.credits ?? 0
  }
  const ceiling = steps.reduce((s, st) => s + creditsFor(st.providerId, st.operation), 0)

  function addStep() {
    const provider = providers[0]
    if (!provider) return
    const op = providerOperations(provider)[0] ?? 'find_email'
    const firstOut = OP_META[op].outputs[0]
    setSteps((prev) => [
      ...prev,
      {
        key: nextKey(),
        providerId: provider.id,
        operation: op,
        inputMapping: {},
        outputMapping: firstOut ? { [firstOut]: anchorId } : {},
        acceptanceCondition: 'nonEmptyField',
        acceptField: firstOut,
      },
    ])
  }
  function patchStep(key: string, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  function move(i: number, to: number) {
    if (to < 0 || to >= steps.length) return
    setSteps((prev) => {
      const copy = prev.slice()
      const [m] = copy.splice(i, 1)
      if (m) copy.splice(to, 0, m)
      return copy
    })
  }
  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key))
  }

  function onProviderChange(step: DraftStep, providerId: string) {
    const provider = providers.find((p) => p.id === providerId)
    const op = provider ? providerOperations(provider)[0] ?? step.operation : step.operation
    const firstOut = OP_META[op].outputs[0]
    patchStep(step.key, { providerId, operation: op, outputMapping: firstOut ? { [firstOut]: anchorId } : {}, acceptField: firstOut })
  }
  function onOperationChange(step: DraftStep, operation: EnrichmentOperation) {
    const firstOut = OP_META[operation].outputs[0]
    patchStep(step.key, { operation, inputMapping: {}, outputMapping: firstOut ? { [firstOut]: anchorId } : {}, acceptField: firstOut })
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const built: EnrichmentStep[] = steps.map((s) => {
        const credits = creditsFor(s.providerId, s.operation)
        const providerCostUsd = providers.find((p) => p.id === s.providerId)?.costConfig[s.operation]?.providerCostUsd ?? 0
        const inputMapping = Object.fromEntries(Object.entries(s.inputMapping).filter(([, v]) => v))
        const outputMapping = Object.fromEntries(Object.entries(s.outputMapping).filter(([, v]) => v))
        return {
          providerId: s.providerId,
          operation: s.operation,
          inputMapping,
          outputMapping,
          acceptanceCondition: s.acceptanceCondition,
          acceptField: s.acceptField,
          minConfidence: s.minConfidence,
          credits,
          providerCostUsd,
        }
      })
      return getApi().enrichment.configs.upsert({ columnId: anchorId, steps: built, autoRun })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enrichment', 'config', anchorId] })
      void qc.invalidateQueries({ queryKey: ['enrichment', 'configs', tableId] })
      toast('Waterfall saved', { variant: 'success' })
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the waterfall'), { variant: 'error' }),
  })

  function stepIncomplete(s: DraftStep): boolean {
    return (
      Object.values(s.inputMapping).filter(Boolean).length === 0 ||
      Object.values(s.outputMapping).filter(Boolean).length === 0
    )
  }

  function validateAndSave() {
    setAttempted(true)
    if (steps.length === 0 || steps.some(stepIncomplete)) return
    saveMutation.mutate()
  }

  const anchor = columns.find((c) => c.id === anchorId)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Waterfall builder"
      description="Chain providers in fall-through order. A row only reaches a step if every step above returned nothing usable."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={validateAndSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save waterfall'}
          </Button>
        </>
      }
    >
      <div className={styles.builder}>
        <div className={styles.builderHead}>
          {column ? (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{column.name}</span>
          ) : (
            <Field label="Enrichment column" htmlFor="anchor-col">
              <Select id="anchor-col" value={anchorId} onChange={(e) => setAnchorId(e.target.value)}>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Tag mono tone="gold">
            {steps.length} step{steps.length === 1 ? '' : 's'} · est. ≤ {ceiling} cr/row
          </Tag>
        </div>

        {steps.map((step, i) => {
          const provider = providers.find((p) => p.id === step.providerId)
          const ops = provider ? providerOperations(provider) : []
          const meta = OP_META[step.operation]
          return (
            <div key={step.key} className={styles.stepCard}>
              <div className={styles.stepTop}>
                <span className={styles.stepNum}>{i + 1}</span>
                <div className={styles.stepGrow}>
                  <div className={styles.mapGrid}>
                    <Select value={step.providerId} onChange={(e) => onProviderChange(step, e.target.value)} aria-label="Provider">
                      {providers.map((p: Provider) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <Select value={step.operation} onChange={(e) => onOperationChange(step, e.target.value as EnrichmentOperation)} aria-label="Operation">
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {OP_META[op].label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className={styles.stepCtrls}>
                  <button type="button" className="iconBtn iconBtn-sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Move up">
                    <MoveUp />
                  </button>
                  <button type="button" className="iconBtn iconBtn-sm" disabled={i === steps.length - 1} onClick={() => move(i, i + 1)} aria-label="Move down">
                    <MoveDown />
                  </button>
                  <button type="button" className={`iconBtn iconBtn-sm ${styles.danger}`} onClick={() => removeStep(step.key)} aria-label="Remove step">
                    <TrashIcon />
                  </button>
                </div>
              </div>

              <div className={styles.mapGrid}>
                <div className={styles.mapCol}>
                  <span className={styles.mapLabel}>Inputs</span>
                  {meta.inputs.map((field) => (
                    <div key={field} className={styles.mapRow}>
                      <span className={styles.field}>{field}</span>
                      <Select
                        value={step.inputMapping[field] ?? ''}
                        onChange={(e) => patchStep(step.key, { inputMapping: { ...step.inputMapping, [field]: e.target.value } })}
                        aria-label={`Input ${field}`}
                      >
                        <option value="">— none —</option>
                        {columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
                <div className={styles.mapCol}>
                  <span className={styles.mapLabel}>Outputs</span>
                  {meta.outputs.map((field) => (
                    <div key={field} className={styles.mapRow}>
                      <span className={styles.field}>{field}</span>
                      <Select
                        value={step.outputMapping[field] ?? ''}
                        onChange={(e) => patchStep(step.key, { outputMapping: { ...step.outputMapping, [field]: e.target.value } })}
                        aria-label={`Output ${field}`}
                      >
                        <option value="">— none —</option>
                        {columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {attempted && stepIncomplete(step) && (
                <span className={styles.reqError} role="alert">
                  Map at least one input and one output for this step.
                </span>
              )}

              <div className={styles.acceptRow}>
                <Field label="Accept when" htmlFor={`acc-${step.key}`}>
                  <Select
                    id={`acc-${step.key}`}
                    value={step.acceptanceCondition}
                    onChange={(e) => patchStep(step.key, { acceptanceCondition: e.target.value as AcceptanceCondition })}
                  >
                    {(['empty', 'nonEmptyField', 'minConfidence', 'verifyDeliverable'] as AcceptanceCondition[]).map((a) => (
                      <option key={a} value={a}>
                        {ACCEPTANCE_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {step.acceptanceCondition === 'nonEmptyField' && (
                  <Field label="Required field" htmlFor={`af-${step.key}`}>
                    <Select id={`af-${step.key}`} value={step.acceptField ?? ''} onChange={(e) => patchStep(step.key, { acceptField: e.target.value })}>
                      {meta.outputs.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {step.acceptanceCondition === 'minConfidence' && (
                  <Field label="Min confidence (0–1)" htmlFor={`mc-${step.key}`}>
                    <Input
                      id={`mc-${step.key}`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={step.minConfidence ?? 0.6}
                      onChange={(e) => patchStep(step.key, { minConfidence: Number(e.target.value) })}
                    />
                  </Field>
                )}
              </div>
              <span className={styles.stepCost}>{creditsFor(step.providerId, step.operation)} cr/row</span>
            </div>
          )
        })}

        <Button variant="ghost" size="sm" className={styles.addStep} onClick={addStep} disabled={providers.length === 0}>
          + Add provider step
        </Button>
        {attempted && steps.length === 0 && (
          <span className={styles.reqError} role="alert">Add at least one provider step.</span>
        )}

        <div className={styles.switchRow}>
          <span className={styles.lbl}>
            Auto-run on new rows
            {anchor ? <span className={styles.previewLabel}> · enriches {anchor.name} as rows arrive</span> : null}
          </span>
          <Switch checked={autoRun} onCheckedChange={setAutoRun} aria-label="Auto-run on new rows" />
        </div>
      </div>
    </Dialog>
  )
}
