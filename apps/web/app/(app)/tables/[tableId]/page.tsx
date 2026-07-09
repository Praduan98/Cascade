'use client'
// The table surface — the product's centrepiece. Loads the table meta, columns
// and views through getApi(), frames the grid with a live toolbar, and mounts
// @cascade/grid's TableGridDynamic (which owns inline editing, the persistent
// add-row, frozen columns and last-write-wins conflict handling). Column and row
// management live at this level: adding/renaming/retyping/reordering/freezing/
// deleting columns and bulk-deleting rows, each re-mounting the grid so its
// canvas reflects the change. Viewers get a read-only grid and disabled
// mutations; the API also enforces this and those 403s surface as toasts.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi, isApiError } from '@cascade/data'
import { canWrite } from '@cascade/core'
import type { Column, View } from '@cascade/core'
import { TableGridDynamic } from '@cascade/grid'
import { Alert, Button, Dialog, DialogClose, EmptyState, useToast } from '@cascade/ui'
import { useSession } from '../../../session'
import { errorMessage } from '../../../lib/ui'
import { GridToolbar } from './_components/GridToolbar'
import { AddColumnDialog } from './_components/AddColumnDialog'
import { EditColumnDialog } from './_components/EditColumnDialog'
import { ManageColumnsDialog } from './_components/ManageColumnsDialog'
import { BulkDeleteDialog } from './_components/BulkDeleteDialog'
import styles from './table-surface.module.css'

function ColumnGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}

export default function TableSurfacePage() {
  const params = useParams<{ tableId: string }>()
  const tableId = params.tableId
  const { role } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const writable = role ? canWrite(role) : false

  const [gridKey, setGridKey] = useState(0)
  const [activeViewId, setActiveViewId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Column | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Column | null>(null)

  const metaQuery = useQuery({
    queryKey: ['table', tableId],
    queryFn: () => getApi().tables.get(tableId),
    enabled: !!tableId,
  })

  const columnsQuery = useQuery({
    queryKey: ['columns', tableId],
    queryFn: () => getApi().columns.list(tableId),
    enabled: !!tableId,
  })

  const viewsQuery = useQuery({
    queryKey: ['views', tableId],
    queryFn: () => getApi().views.list(tableId),
    enabled: !!tableId,
  })

  const columns = useMemo(
    () => (columnsQuery.data ? columnsQuery.data.slice().sort((a, b) => a.position - b.position) : []),
    [columnsQuery.data],
  )
  const views = useMemo(() => viewsQuery.data ?? [], [viewsQuery.data])

  // Resolve the active view once views load: prefer a valid ?view= from the URL,
  // then the table's default view, then the first.
  useEffect(() => {
    if (views.length === 0) return
    if (activeViewId && views.some((v) => v.id === activeViewId)) return
    let target: View | undefined
    try {
      const urlView = new URLSearchParams(window.location.search).get('view')
      if (urlView) target = views.find((v) => v.id === urlView)
    } catch {
      /* SSR / no window */
    }
    if (!target) target = views.find((v) => v.isDefault) ?? views[0]
    if (target) setActiveViewId(target.id)
  }, [views, activeViewId])

  // Reflect the active view in the URL (?view=<id>) so it's shareable and
  // survives reload. history.replaceState keeps it out of the back-stack and
  // avoids a router round-trip.
  useEffect(() => {
    if (!activeViewId) return
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('view') !== activeViewId) {
        url.searchParams.set('view', activeViewId)
        window.history.replaceState(window.history.state, '', url.toString())
      }
    } catch {
      /* SSR / no window */
    }
  }, [activeViewId])

  const effectiveViewId = activeViewId || undefined

  const rowCountQuery = useQuery({
    queryKey: ['rowCount', tableId, effectiveViewId],
    queryFn: () => getApi().records.count(tableId, effectiveViewId),
    enabled: !!tableId,
  })

  function remountGrid() {
    setGridKey((k) => k + 1)
  }
  function onColumnsChanged() {
    remountGrid()
  }
  function onRowsDeleted() {
    void qc.invalidateQueries({ queryKey: ['rowCount', tableId] })
    remountGrid()
  }

  const deleteColumnMutation = useMutation({
    mutationFn: (columnId: string) => getApi().columns.remove(columnId),
    onSuccess: (_res, columnId) => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      const name = deleteTarget?.id === columnId ? deleteTarget?.name : undefined
      toast(name ? `Deleted column “${name}”` : 'Column deleted', { variant: 'success' })
      setDeleteTarget(null)
      remountGrid()
    },
    onError: (err) => toast(errorMessage(err, 'Could not delete column'), { variant: 'error' }),
  })

  // Transitions out of the manage dialog wait a tick so the two Radix dialogs
  // never fight over the focus trap (mirrors the tables list page pattern).
  function requestAdd() {
    setManageOpen(false)
    setTimeout(() => setAddOpen(true), 0)
  }
  function requestEdit(col: Column) {
    setManageOpen(false)
    setTimeout(() => setEditTarget(col), 0)
  }
  function requestDelete(col: Column) {
    setManageOpen(false)
    setTimeout(() => setDeleteTarget(col), 0)
  }

  // ---- Loading / error ----
  if (metaQuery.isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <div className={styles.spinner} role="status" aria-label="Loading table" />
        </div>
      </div>
    )
  }

  if (metaQuery.isError || !metaQuery.data) {
    const notFound = isApiError(metaQuery.error) && metaQuery.error.status === 404
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <div className={styles.errorBox}>
            <Alert variant="error" title={notFound ? 'Table not found' : 'Couldn’t load this table'}>
              {notFound
                ? 'It may have been deleted, or you may not have access to it.'
                : errorMessage(metaQuery.error)}
            </Alert>
            <Link href="/tables" className="btn btn-secondary">
              ← Back to tables
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const table = metaQuery.data
  const columnsEmpty = columnsQuery.isSuccess && columns.length === 0

  return (
    <div className={styles.page}>
      <GridToolbar
        tableName={table.name}
        rowCount={rowCountQuery.data}
        rowCountLoading={rowCountQuery.isLoading}
        tableId={tableId}
        columns={columns}
        views={views}
        activeViewId={activeViewId}
        onChangeView={setActiveViewId}
        writable={writable}
        onAddColumn={() => setAddOpen(true)}
        onManageColumns={() => setManageOpen(true)}
        onDeleteRows={() => setBulkOpen(true)}
        remountGrid={remountGrid}
      />

      <div className={styles.gridHost}>
        {columnsEmpty ? (
          <EmptyState
            icon={<ColumnGlyph />}
            title="This table has no columns yet"
            description={
              writable
                ? 'Add your first column to start entering data.'
                : 'No columns have been added to this table yet.'
            }
            action={
              writable ? (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  Add column
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableGridDynamic
            key={gridKey}
            tableId={tableId}
            viewId={effectiveViewId}
            readOnly={!writable}
          />
        )}
      </div>

      <AddColumnDialog open={addOpen} onOpenChange={setAddOpen} tableId={tableId} onAdded={onColumnsChanged} />

      <ManageColumnsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        tableId={tableId}
        columns={columns}
        writable={writable}
        onRequestAdd={requestAdd}
        onRequestEdit={requestEdit}
        onRequestDelete={requestDelete}
        onChanged={onColumnsChanged}
      />

      <EditColumnDialog
        open={editTarget != null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        tableId={tableId}
        column={editTarget}
        onChanged={onColumnsChanged}
      />

      <BulkDeleteDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        tableId={tableId}
        viewId={effectiveViewId}
        columns={columns}
        total={rowCountQuery.data ?? 0}
        onDeleted={onRowsDeleted}
      />

      {/* Delete column confirm */}
      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="Delete column"
        description={
          deleteTarget
            ? `This permanently removes “${deleteTarget.name}” and every value in it. This can’t be undone.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => deleteTarget && deleteColumnMutation.mutate(deleteTarget.id)}
              disabled={deleteColumnMutation.isPending}
            >
              {deleteColumnMutation.isPending ? 'Deleting…' : 'Delete column'}
            </Button>
          </>
        }
      />
    </div>
  )
}
