'use client'
// Toolbar entry point for CSV import. Writers only (the mock API also enforces
// this). Owns the wizard's open state and, when an import completes, refreshes
// the column + row-count queries and re-mounts the grid so the new data shows.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Column } from '@cascade/core'
import { Button } from '@cascade/ui'
import { ImportWizard } from './ImportWizard'
import type { ImportOutcome } from './csvImport'
import styles from '../../table-surface.module.css'

interface Props {
  tableId: string
  columns: Column[]
  writable: boolean
  /** Force the grid to re-read after rows/columns are added. */
  remountGrid: () => void
}

function IconImport() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

export function ImportButton({ tableId, columns, writable, remountGrid }: Props) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  function handleImported(outcome: ImportOutcome) {
    if (outcome.imported > 0 || outcome.columnsCreated > 0) {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      void qc.invalidateQueries({ queryKey: ['rowCount', tableId] })
      remountGrid()
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={!writable}>
        <IconImport />
        Import
      </Button>
      <ImportWizard
        open={open}
        onOpenChange={setOpen}
        tableId={tableId}
        columns={columns}
        onImported={handleImported}
      />
    </>
  )
}
