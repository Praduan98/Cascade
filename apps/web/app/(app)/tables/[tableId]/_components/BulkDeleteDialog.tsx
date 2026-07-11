'use client'
// Bulk row delete. The grid canvas doesn't surface its selection to the page, so
// selection lives here: a paginated, checkbox list of rows (windowed through
// records.list a page at a time, so it stays light even at 100k rows). Chosen
// rows are removed via records.bulkDelete behind an inline confirm, then the
// grid + row count refresh.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { PAGE_SIZE } from '@cascade/grid'
import { getColumnType } from '@cascade/core'
import type { Column } from '@cascade/core'
import { Button, Dialog, DialogClose, EmptyState, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../lib/ui'
import styles from '../column-tools.module.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  viewId?: string
  columns: Column[]
  total: number
  onDeleted: () => void
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

export function BulkDeleteDialog({ open, onOpenChange, tableId, viewId, columns, total, onDeleted }: Props) {
  const { toast } = useToast()
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (open) {
      setPage(0)
      setSelected(new Set())
      setConfirming(false)
    }
  }, [open])

  const primary = columns[0]
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const rowsQuery = useQuery({
    queryKey: ['bulk-rows', tableId, viewId, page],
    queryFn: () => getApi().records.list(tableId, { viewId, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
    enabled: open && total > 0,
    staleTime: 5_000,
  })

  const rows = useMemo(() => rowsQuery.data?.rows ?? [], [rowsQuery.data])
  const pageIds = useMemo(() => rows.map((r) => r.row.id), [rows])
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setConfirming(false)
  }
  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
    setConfirming(false)
  }

  const deleteMutation = useMutation({
    mutationFn: () => getApi().records.bulkDelete(tableId, [...selected]),
    onSuccess: (res) => {
      toast(`Deleted ${res.deleted} row${res.deleted === 1 ? '' : 's'}`, { variant: 'success' })
      onDeleted()
      onOpenChange(false)
    },
    onError: (err) => {
      toast(errorMessage(err, 'Could not delete rows'), { variant: 'error' })
      setConfirming(false)
    },
  })

  const count = selected.size

  const footer =
    total === 0 ? (
      <DialogClose asChild>
        <Button variant="ghost">Close</Button>
      </DialogClose>
    ) : confirming ? (
      <>
        <span className={styles.confirmText}>Delete {count} selected row{count === 1 ? '' : 's'}? This can’t be undone.</span>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleteMutation.isPending}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
          {deleteMutation.isPending ? 'Deleting…' : `Delete ${count} row${count === 1 ? '' : 's'}`}
        </Button>
      </>
    ) : (
      <>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={count === 0}>
          Delete {count > 0 ? `${count} ` : ''}selected
        </Button>
      </>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete rows"
      description={total > 0 ? 'Select the rows you want to remove.' : undefined}
      footer={footer}
    >
      {total === 0 ? (
        <EmptyState title="No rows to delete" description="This table is empty." />
      ) : (
        <>
          <div className={styles.rowsHead}>
            <label className={styles.selectAll}>
              <input
                type="checkbox"
                className={styles.srCheck}
                checked={allOnPageSelected}
                onChange={toggleAllOnPage}
                aria-label="Select all rows on this page"
              />
              <span className={[styles.check, allOnPageSelected ? styles.on : ''].filter(Boolean).join(' ')} aria-hidden="true">
                {allOnPageSelected && <CheckIcon />}
              </span>
              Select all on page
            </label>
            <span className={styles.selCount}>{count} selected</span>
          </div>

          <div className={styles.rowList}>
            {rowsQuery.isLoading ? (
              <span className={styles.optHint} style={{ padding: '10px' }}>Loading rows…</span>
            ) : (
              rows.map((r) => {
                const on = selected.has(r.row.id)
                const value = primary ? r.cells[primary.id]?.value ?? null : null
                const label = primary ? getColumnType(primary.type).formatDisplay(value, primary.config) : ''
                return (
                  <label
                    key={r.row.id}
                    className={[styles.rowItem, on ? styles.on : ''].filter(Boolean).join(' ')}
                  >
                    <input
                      type="checkbox"
                      className={styles.srCheck}
                      checked={on}
                      onChange={() => toggle(r.row.id)}
                      aria-label={`Select row ${r.row.position + 1}${label ? ` — ${label}` : ''}`}
                    />
                    <span className={[styles.check, on ? styles.on : ''].filter(Boolean).join(' ')} aria-hidden="true">
                      {on && <CheckIcon />}
                    </span>
                    <span className={styles.rowPos}>#{r.row.position + 1}</span>
                    <span className={[styles.rowLabel, label ? '' : styles.empty].filter(Boolean).join(' ')}>
                      {label || 'Empty'}
                    </span>
                  </label>
                )
              })
            )}
          </div>

          <div className={styles.pager}>
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Prev
            </Button>
            <span className={styles.pageInfo}>
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next →
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
