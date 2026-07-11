'use client'
// The formula column authoring dialog (US-3.6) — write a computed expression over
// other columns with {{references}}, if/then/else, and string/number/date/boolean
// operations. Synchronous, no credits: the cell recomputes when a referenced cell
// changes. Live-validates the expression before saving.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Column } from '@cascade/core'
import { validateFormula } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { PromptEditor } from '../ai/PromptEditor'
import styles from '../ai/ai-column.module.css'
import fx from './formula-column.module.css'

const EXAMPLES = [
  'IF({{Employees}} > 500, "Enterprise", "SMB")',
  'UPPER({{Company}}) & " — " & {{Domain}}',
  'ROUND({{MRR}} * 12, 0)',
  'YEAR({{Signed}})',
]
const FUNCTIONS = 'IF · AND · OR · NOT · CONCAT · UPPER · LOWER · TRIM · LEN · LEFT · RIGHT · CONTAINS · ROUND · ABS · MIN · MAX · COALESCE · ISEMPTY · YEAR · MONTH · DAY'

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

export function FormulaColumnBuilder({ open, onOpenChange, tableId, columns, column, seedName, onSaved }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [newName, setNewName] = useState('')
  const [expression, setExpression] = useState('')

  const configQuery = useQuery({
    queryKey: ['formula', 'config', column?.id],
    queryFn: () => getApi().formula.get(column!.id),
    enabled: open && !!column,
  })

  useEffect(() => {
    if (!open) return
    setNewName(seedName ?? '')
    const cfg = configQuery.data
    if (cfg) setExpression(cfg.expression)
    else if (!column) setExpression('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configQuery.data, column, seedName])

  // Live client-side validation (the same evaluator the engine uses).
  const error = useMemo(() => (expression.trim() ? validateFormula(expression.trim()) : null), [expression])

  const save = useMutation({
    mutationFn: async () => {
      const api = getApi()
      let anchorId = column?.id
      if (!anchorId) {
        const created = await api.columns.add(tableId, { name: newName.trim(), type: 'formula', config: { type: 'formula' } })
        anchorId = created.id
      }
      return api.formula.upsert({ columnId: anchorId, expression: expression.trim() })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      void qc.invalidateQueries({ queryKey: ['formula', 'configs', tableId] })
      if (column) void qc.invalidateQueries({ queryKey: ['formula', 'config', column.id] })
      toast('Formula column saved', { variant: 'success' })
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not save the formula column'), { variant: 'error' }),
  })

  function validateAndSave() {
    if (!column && newName.trim() === '') {
      toast('Name the formula column', { variant: 'warn' })
      return
    }
    if (expression.trim() === '') {
      toast('Enter a formula expression', { variant: 'warn' })
      return
    }
    if (error) {
      toast(`Invalid formula: ${error}`, { variant: 'warn' })
      return
    }
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Formula column"
      description="Compute a value from other columns. It recomputes automatically when a referenced cell changes — no credits, no runs."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={validateAndSave} disabled={save.isPending || !!error}>
            {save.isPending ? 'Saving…' : 'Save formula column'}
          </Button>
        </>
      }
    >
      <div className={styles.builder}>
        {!column && (
          <Field label="Column name" htmlFor="fx-col-name">
            <Input id="fx-col-name" autoFocus placeholder="e.g. Segment" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
        )}

        <Field
          label="Expression"
          hint={error ?? 'Insert {{column}} references; substituted per row.'}
          error={!!error}
        >
          <PromptEditor label="Expression" value={expression} onChange={setExpression} columns={columns} />
        </Field>

        {!error && expression.trim() ? <div className={fx.ok}>Expression is valid.</div> : null}

        <div className={fx.help}>
          <div className={fx.helpHead}>Functions</div>
          <div className={fx.funcs}>{FUNCTIONS}</div>
          <div className={fx.helpHead}>Examples</div>
          <ul className={fx.examples}>
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" className={fx.example} onClick={() => setExpression(ex)}>{ex}</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
