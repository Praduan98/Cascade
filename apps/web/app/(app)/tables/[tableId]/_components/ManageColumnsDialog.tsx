'use client'
// Columns manager: reorder (up/down), freeze/pin (Switch), and jump to edit or
// delete for each column. Reordering and freezing persist immediately through
// columns.reorder / columns.update and re-mount the grid via onChanged; edit and
// delete are handed back to the page so their dialogs don't nest inside this one.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { getColumnType } from '@cascade/core'
import type { Column } from '@cascade/core'
import { Button, Dialog, DialogClose, Switch, Tooltip, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../lib/ui'
import styles from '../column-tools.module.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  columns: Column[]
  writable: boolean
  onRequestAdd: () => void
  onRequestEdit: (column: Column) => void
  onRequestDelete: (column: Column) => void
  onChanged: () => void
}

function ChevronUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}
function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="15" height="15">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="15" height="15">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  )
}

export function ManageColumnsDialog({
  open,
  onOpenChange,
  tableId,
  columns,
  writable,
  onRequestAdd,
  onRequestEdit,
  onRequestDelete,
  onChanged,
}: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  function afterChange() {
    void qc.invalidateQueries({ queryKey: ['columns', tableId] })
    onChanged()
  }

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => getApi().columns.reorder(tableId, orderedIds),
    onSuccess: afterChange,
    onError: (err) => toast(errorMessage(err, 'Could not reorder columns'), { variant: 'error' }),
  })

  const freezeMutation = useMutation({
    mutationFn: (vars: { id: string; isFrozen: boolean }) =>
      getApi().columns.update(vars.id, { isFrozen: vars.isFrozen }),
    onSuccess: afterChange,
    onError: (err) => toast(errorMessage(err, 'Could not update column'), { variant: 'error' }),
  })

  const busy = reorderMutation.isPending || freezeMutation.isPending

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= columns.length) return
    const ids = columns.map((c) => c.id)
    const [moved] = ids.splice(index, 1)
    if (moved === undefined) return
    ids.splice(target, 0, moved)
    reorderMutation.mutate(ids)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage columns"
      description="Reorder, freeze, edit, or remove the columns in this table."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Done</Button>
          </DialogClose>
          {writable && (
            <Button variant="primary" onClick={onRequestAdd}>
              Add column
            </Button>
          )}
        </>
      }
    >
      <div className={styles.colList}>
        {columns.map((col, i) => {
          const def = getColumnType(col.type)
          return (
            <div key={col.id} className={[styles.colRow, col.isFrozen ? styles.frozen : ''].filter(Boolean).join(' ')}>
              <div className={styles.reorder}>
                <button type="button" aria-label="Move up" disabled={!writable || busy || i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={!writable || busy || i === columns.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ChevronDown />
                </button>
              </div>
              <div className={styles.colMeta}>
                <span className={styles.typeBadge}>{def.typeBadge}</span>
                <span className={styles.colName}>{col.name}</span>
                <span className={styles.colType}>{def.label}</span>
              </div>
              <div className={styles.colCtrls}>
                <Tooltip content={col.isFrozen ? 'Unfreeze column' : 'Freeze to the left edge'}>
                  <label className={styles.freezeLabel}>
                    Pin
                    <Switch
                      checked={col.isFrozen}
                      disabled={!writable || busy}
                      onCheckedChange={(v) => freezeMutation.mutate({ id: col.id, isFrozen: v })}
                      aria-label={`Freeze ${col.name}`}
                    />
                  </label>
                </Tooltip>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Edit ${col.name}`}
                  disabled={!writable}
                  onClick={() => onRequestEdit(col)}
                >
                  <PencilIcon />
                </button>
                <Tooltip content={columns.length <= 1 ? 'A table needs at least one column' : `Delete ${col.name}`}>
                  <span style={{ display: 'inline-flex' }}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`Delete ${col.name}`}
                      disabled={!writable || columns.length <= 1}
                      onClick={() => onRequestDelete(col)}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}
