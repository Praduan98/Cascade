'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { TableMeta } from '@cascade/core'
import { canWrite } from '@cascade/core'
import { iconForTable } from '../_components/tableIcon'
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogClose,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  useToast,
} from '@cascade/ui'
import { useSession } from '../../session'
import { CreateTableDialog } from '../_components/CreateTableDialog'
import { errorMessage, formatDate } from '../../lib/ui'
import styles from './tables.module.css'

function TableGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </svg>
  )
}
function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}

export default function TablesPage() {
  const { workspace, role } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const writable = role ? canWrite(role) : false
  const workspaceId = workspace?.id

  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<TableMeta | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<TableMeta | null>(null)

  const tablesQuery = useQuery({
    queryKey: ['tables', workspaceId],
    queryFn: () => getApi().tables.list(workspaceId!),
    enabled: !!workspaceId,
  })

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['tables', workspaceId] })
  }

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) => getApi().tables.rename(vars.id, vars.name),
    onSuccess: (table) => {
      invalidate()
      toast(`Renamed to “${table.name}”`, { variant: 'success' })
      setRenameTarget(null)
    },
    onError: (err) => toast(errorMessage(err, 'Could not rename table'), { variant: 'error' }),
  })

  const duplicateMutation = useMutation({
    mutationFn: (vars: { id: string; includeRecords: boolean }) =>
      getApi().tables.duplicate(vars.id, { includeRecords: vars.includeRecords }),
    onSuccess: (table) => {
      invalidate()
      toast(`Created “${table.name}”`, { variant: 'success' })
    },
    onError: (err) => toast(errorMessage(err, 'Could not duplicate table'), { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getApi().tables.remove(id),
    onSuccess: (_res, id) => {
      invalidate()
      const name = deleteTarget?.id === id ? deleteTarget?.name : undefined
      toast(name ? `Deleted “${name}”` : 'Table deleted', { variant: 'success' })
      setDeleteTarget(null)
    },
    onError: (err) => toast(errorMessage(err, 'Could not delete table'), { variant: 'error' }),
  })

  // Open the dialogs on a fresh tick so the dropdown menu's close doesn't fight
  // the dialog's focus trap.
  function openRename(t: TableMeta) {
    setRenameValue(t.name)
    setTimeout(() => setRenameTarget(t), 0)
  }
  function openDelete(t: TableMeta) {
    setTimeout(() => setDeleteTarget(t), 0)
  }

  function submitRename() {
    const name = renameValue.trim()
    if (!renameTarget || !name || renameMutation.isPending) return
    renameMutation.mutate({ id: renameTarget.id, name })
  }

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  const tables = tablesQuery.data ?? []

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Tables</h1>
          <div className={styles.count}>
            {tablesQuery.isLoading
              ? 'Loading…'
              : `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} in ${workspace.name}`}
          </div>
        </div>
        {writable && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New table
          </Button>
        )}
      </header>

      {tablesQuery.isError && (
        <Alert variant="error" title="Couldn’t load tables" className={styles.state}>
          {errorMessage(tablesQuery.error)}
        </Alert>
      )}

      {tablesQuery.isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className={styles.skeletonCard}>
              <div className={styles.skelRow}>
                <div className={styles.skelBlock} style={{ width: 36, height: 36 }} />
                <div className={styles.skelBlock} style={{ height: 15, flex: 1 }} />
              </div>
              <div className={styles.skelBlock} style={{ height: 12, width: '55%' }} />
            </Card>
          ))}
        </div>
      ) : tables.length === 0 ? (
        <EmptyState
          className={styles.state}
          icon={<TableGlyph />}
          title="No tables yet"
          description={
            writable
              ? 'Create your first table to start collecting and enriching records.'
              : 'No tables have been created in this workspace yet.'
          }
          action={
            writable ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                New table
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={styles.grid}>
          {tables.map((t) => (
            <Card key={t.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.tableGlyph}>
                  {iconForTable(t.name)}
                </span>
                <Link href={`/tables/${t.id}`} className={styles.name}>
                  {t.name}
                </Link>
                {writable && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={styles.kebab} aria-label={`Actions for ${t.name}`}>
                        <DotsIcon />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openRename(t)}>Rename</DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => duplicateMutation.mutate({ id: t.id, includeRecords: true })}
                      >
                        Duplicate with records
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => duplicateMutation.mutate({ id: t.id, includeRecords: false })}
                      >
                        Duplicate structure only
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger onSelect={() => openDelete(t)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className={styles.meta}>
                <span>Created {formatDate(t.createdAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspace.id} />

      {/* Rename */}
      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null)
        }}
        title="Rename table"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={submitRename}
              disabled={!renameValue.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Field label="Table name" htmlFor="rename-table-name">
          <Input
            id="rename-table-name"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              }
            }}
          />
        </Field>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="Delete table"
        description={
          deleteTarget
            ? `This permanently deletes “${deleteTarget.name}” and all of its records. This can’t be undone.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete table'}
            </Button>
          </>
        }
      />
    </div>
  )
}
