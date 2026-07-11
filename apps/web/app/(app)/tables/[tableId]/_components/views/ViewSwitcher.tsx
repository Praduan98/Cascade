'use client'
// The saved-view switcher. Replaces the old segmented control: a dropdown over
// every view (checkmark on the active one, badge on the undeletable default),
// plus writer-only actions to create a view from the current filter/sort/field
// config, rename the active view, or delete it (never the default). All persist
// through getApi().views.*; switching a view is a read and stays available to
// viewers.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { View } from '@cascade/core'
import {
  Button,
  Dialog,
  DialogClose,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  PlusIcon,
  TrashIcon,
  useToast,
} from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import styles from './views.module.css'

interface Props {
  tableId: string
  views: View[]
  activeViewId: string
  activeView: View | undefined
  writable: boolean
  onChangeView: (id: string) => void
}

function IconView() {
  return (
    <svg className={styles.switcherIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
    </svg>
  )
}
function Caret() {
  return (
    <svg className={styles.caret} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
function Check() {
  return (
    <svg className={styles.viewCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}
function IconPencil() {
  return (
    <svg className={styles.menuActionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function ViewSwitcher({ tableId, views, activeViewId, activeView, writable, onChangeView }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState('')

  function invalidateViews() {
    void qc.invalidateQueries({ queryKey: ['views', tableId] })
  }

  const createMutation = useMutation({
    mutationFn: (viewName: string) =>
      getApi().views.create(tableId, {
        name: viewName,
        filters: activeView?.filters,
        sorts: activeView?.sorts,
        columnState: activeView?.columnState,
      }),
    onSuccess: (view) => {
      invalidateViews()
      toast(`Created view “${view.name}”`, { variant: 'success' })
      onChangeView(view.id)
      setCreateOpen(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not create view'), { variant: 'error' }),
  })

  const renameMutation = useMutation({
    mutationFn: (viewName: string) => getApi().views.update(activeViewId, { name: viewName }),
    onSuccess: (view) => {
      invalidateViews()
      toast(`Renamed view to “${view.name}”`, { variant: 'success' })
      setRenameOpen(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not rename view'), { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => getApi().views.remove(activeViewId),
    onSuccess: () => {
      invalidateViews()
      toast('View deleted', { variant: 'success' })
      const fallback = views.find((v) => v.isDefault) ?? views.find((v) => v.id !== activeViewId)
      if (fallback) onChangeView(fallback.id)
      setDeleteOpen(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not delete view'), { variant: 'error' }),
  })

  // Open a dialog after the menu has closed so the two focus traps don't fight.
  function openCreate() {
    setName('')
    setTimeout(() => setCreateOpen(true), 0)
  }
  function openRename() {
    setName(activeView?.name ?? '')
    setTimeout(() => setRenameOpen(true), 0)
  }
  function openDelete() {
    setTimeout(() => setDeleteOpen(true), 0)
  }

  const canDeleteActive = !!activeView && !activeView.isDefault
  const label = activeView?.name ?? 'Grid view'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={styles.switcher} aria-label="Switch view">
            <IconView />
            <span className={styles.switcherName}>{label}</span>
            <Caret />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={styles.menu}>
          <div className={styles.menuScroll}>
            {views.map((v) => (
              <DropdownMenuItem key={v.id} className={styles.viewItem} onSelect={() => onChangeView(v.id)}>
                <span className={[styles.viewCheck, v.id === activeViewId ? '' : styles.hidden].filter(Boolean).join(' ')}>
                  <Check />
                </span>
                <span className={styles.viewItemName}>{v.name}</span>
                {v.isDefault && <span className={styles.defaultBadge}>Default</span>}
              </DropdownMenuItem>
            ))}
          </div>
          {writable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={styles.viewItem} onSelect={openCreate}>
                <PlusIcon className={styles.menuActionIcon} />
                <span className={styles.viewItemName}>Create view from current…</span>
              </DropdownMenuItem>
              <DropdownMenuItem className={styles.viewItem} disabled={!activeView} onSelect={openRename}>
                <IconPencil />
                <span className={styles.viewItemName}>Rename view…</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className={styles.viewItem}
                danger
                disabled={!canDeleteActive}
                onSelect={openDelete}
              >
                <TrashIcon className={styles.menuActionIcon} />
                <span className={styles.viewItemName}>{activeView?.isDefault ? 'Default view can’t be deleted' : 'Delete view…'}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create view */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create view"
        description="Save the current filters, sorts and field layout as a new named view."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={name.trim().length === 0 || createMutation.isPending}
              onClick={() => name.trim() && createMutation.mutate(name.trim())}
            >
              {createMutation.isPending ? 'Creating…' : 'Create view'}
            </Button>
          </>
        }
      >
        <Field label="View name" htmlFor="create-view-name">
          <Input
            id="create-view-name"
            autoFocus
            placeholder="e.g. Active leads"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                e.preventDefault()
                createMutation.mutate(name.trim())
              }
            }}
          />
        </Field>
      </Dialog>

      {/* Rename view */}
      <Dialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename view"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={name.trim().length === 0 || renameMutation.isPending}
              onClick={() => name.trim() && renameMutation.mutate(name.trim())}
            >
              {renameMutation.isPending ? 'Saving…' : 'Save name'}
            </Button>
          </>
        }
      >
        <Field label="View name" htmlFor="rename-view-name">
          <Input
            id="rename-view-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                e.preventDefault()
                renameMutation.mutate(name.trim())
              }
            }}
          />
        </Field>
      </Dialog>

      {/* Delete view */}
      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete view"
        description={activeView ? `Delete “${activeView.name}”? Its filters, sorts and layout will be lost. The table's data is not affected.` : undefined}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? 'Deleting…' : 'Delete view'}
            </Button>
          </>
        }
      />
    </>
  )
}
