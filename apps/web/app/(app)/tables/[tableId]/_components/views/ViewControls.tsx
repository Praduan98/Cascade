'use client'
// Composes the whole view system for the toolbar: the saved-view switcher and
// the Filter / Sort / Fields builders. Owns the single mutation that writes the
// active view's config (filters / sorts / columnState) back through
// getApi().views.update — since the grid and row count read by viewId, every
// edit here persists to the active view, then invalidates the count and re-mounts
// the grid so the change applies live.

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { UpdateViewInput } from '@cascade/data'
import type { Column, ColumnState, FilterGroup, SortSpec, View } from '@cascade/core'
import { useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import { ViewSwitcher } from './ViewSwitcher'
import { FilterPopover } from './FilterPopover'
import { SortPopover } from './SortPopover'
import { FieldsPopover } from './FieldsPopover'
import styles from './views.module.css'

interface Props {
  tableId: string
  columns: Column[]
  views: View[]
  activeViewId: string
  writable: boolean
  onChangeView: (id: string) => void
  /** Force the grid to re-read after the active view's config changes. */
  remountGrid: () => void
}

export function ViewControls({ tableId, columns, views, activeViewId, writable, onChangeView, remountGrid }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const activeView = useMemo(() => views.find((v) => v.id === activeViewId), [views, activeViewId])

  const updateMutation = useMutation({
    mutationFn: (patch: UpdateViewInput) => getApi().views.update(activeViewId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['views', tableId] })
      void qc.invalidateQueries({ queryKey: ['rowCount', tableId] })
      remountGrid()
    },
    onError: (err) => toast(errorMessage(err, 'Could not update this view'), { variant: 'error' }),
  })

  function commit(patch: UpdateViewInput) {
    if (!activeViewId) return
    updateMutation.mutate(patch)
  }

  const hasColumns = columns.length > 0

  return (
    <div className={styles.cluster}>
      <ViewSwitcher
        tableId={tableId}
        views={views}
        activeViewId={activeViewId}
        activeView={activeView}
        writable={writable}
        onChangeView={onChangeView}
      />
      {hasColumns && (
        <>
          <FilterPopover
            columns={columns}
            view={activeView}
            writable={writable}
            onCommit={(filters: FilterGroup) => commit({ filters })}
          />
          <SortPopover
            columns={columns}
            view={activeView}
            writable={writable}
            onCommit={(sorts: SortSpec[]) => commit({ sorts })}
          />
          <FieldsPopover
            columns={columns}
            view={activeView}
            writable={writable}
            onCommit={(columnState: ColumnState[]) => commit({ columnState })}
          />
        </>
      )}
    </div>
  )
}
