'use client'
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type {
  AutomationAction,
  AutomationTrigger,
  Column,
  RowEvent,
  ScheduleCadence,
  TableMeta,
} from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, Seg, Switch, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import styles from '../automations.module.css'

/**
 * Create-automation dialog. Builds an `UpsertAutomationInput` from the form and
 * calls `api.automation.automations.upsert`. Table/column choices come from the
 * pre-loaded workspace tables + columns map (no extra fetching here).
 */
export function AutomationDialog({
  open,
  onOpenChange,
  workspaceId,
  tables,
  columnsByTable,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  tables: TableMeta[]
  columnsByTable: Record<string, Column[]>
  onSaved: () => void
}) {
  const { toast } = useToast()
  const firstTableId = tables[0]?.id ?? ''

  const [name, setName] = useState('')
  const [tableId, setTableId] = useState(firstTableId)
  const [trigger, setTrigger] = useState<AutomationTrigger>('schedule')
  const [cadence, setCadence] = useState<ScheduleCadence>('daily')
  const [hour, setHour] = useState('9')
  const [rowEvent, setRowEvent] = useState<RowEvent>('record.created')
  const [watchColumnId, setWatchColumnId] = useState('')
  const [action, setAction] = useState<AutomationAction>('run_column')
  const [targetColumnId, setTargetColumnId] = useState('')
  const [forceFresh, setForceFresh] = useState(false)

  const columns = columnsByTable[tableId] ?? []

  const reset = () => {
    setName('')
    setTableId(firstTableId)
    setTrigger('schedule')
    setCadence('daily')
    setHour('9')
    setRowEvent('record.created')
    setWatchColumnId('')
    setAction('run_column')
    setTargetColumnId('')
    setForceFresh(false)
  }

  const mutation = useMutation({
    mutationFn: () =>
      getApi().automation.automations.upsert(workspaceId, {
        tableId,
        name: name.trim(),
        trigger,
        action,
        targetColumnId: action === 'run_column' ? targetColumnId : undefined,
        forceFresh,
        schedule:
          trigger === 'schedule'
            ? { cadence, ...(cadence === 'hourly' ? {} : { hour: clampHour(hour) }) }
            : undefined,
        rowEvent:
          trigger === 'row_event'
            ? { event: rowEvent, ...(watchColumnId ? { watchColumnId } : {}) }
            : undefined,
      }),
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
      reset()
      toast('Automation created', { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not create the automation'), { variant: 'error' }),
  })

  // Keep the target/watch column selections valid as the table changes.
  const onTableChange = (id: string) => {
    setTableId(id)
    const cols = columnsByTable[id] ?? []
    setTargetColumnId(cols[0]?.id ?? '')
    setWatchColumnId('')
  }

  const canSave = useMemo(() => {
    if (!name.trim() || !tableId) return false
    if (action === 'run_column' && !targetColumnId) return false
    return true
  }, [name, tableId, action, targetColumnId])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
      title="New automation"
      description="Run a column or a whole table on a schedule or when a row changes."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSave || mutation.isPending}
          >
            {mutation.isPending ? 'Creating…' : 'Create automation'}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="auto-name">
        <Input
          id="auto-name"
          autoFocus
          placeholder="Nightly email verification"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Table" htmlFor="auto-table">
        <Select id="auto-table" value={tableId} onChange={(e) => onTableChange(e.target.value)}>
          {tables.length === 0 && <option value="">No tables</option>}
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Trigger">
        <Seg
          aria-label="Trigger type"
          value={trigger}
          onChange={setTrigger}
          options={[
            { value: 'schedule', label: 'Schedule' },
            { value: 'row_event', label: 'Row event' },
          ]}
        />
      </Field>

      {trigger === 'schedule' ? (
        <div className={styles.condRow}>
          <Field label="Cadence" htmlFor="auto-cadence">
            <Select
              id="auto-cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as ScheduleCadence)}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </Select>
          </Field>
          {cadence !== 'hourly' && (
            <Field label="Hour (0–23)" htmlFor="auto-hour">
              <Input
                id="auto-hour"
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              />
            </Field>
          )}
        </div>
      ) : (
        <div className={styles.condRow}>
          <Field label="Event" htmlFor="auto-event">
            <Select id="auto-event" value={rowEvent} onChange={(e) => setRowEvent(e.target.value as RowEvent)}>
              <option value="record.created">Record created</option>
              <option value="record.updated">Record updated</option>
            </Select>
          </Field>
          {rowEvent === 'record.updated' && (
            <Field label="Watch column" htmlFor="auto-watch" hint="Optional — fire only when this changes.">
              <Select
                id="auto-watch"
                value={watchColumnId}
                onChange={(e) => setWatchColumnId(e.target.value)}
              >
                <option value="">Any column</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}

      <Field label="Action">
        <Seg
          aria-label="Action type"
          value={action}
          onChange={setAction}
          options={[
            { value: 'run_column', label: 'Run a column' },
            { value: 'run_table', label: 'Run whole table' },
          ]}
        />
      </Field>

      {action === 'run_column' && (
        <Field label="Target column" htmlFor="auto-target">
          <Select
            id="auto-target"
            value={targetColumnId}
            onChange={(e) => setTargetColumnId(e.target.value)}
          >
            <option value="">Choose a column…</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Force fresh" hint="Ignore cached results and re-run every targeted cell.">
        <Switch checked={forceFresh} onCheckedChange={setForceFresh} aria-label="Force fresh" />
      </Field>
    </Dialog>
  )
}

function clampHour(raw: string): number {
  const n = Number(raw)
  if (Number.isNaN(n)) return 9
  return Math.min(23, Math.max(0, Math.trunc(n)))
}
