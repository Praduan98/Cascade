'use client'
// The grid toolbar: table identity + live row count on the left; the view system
// (saved-view switcher + Filter / Sort / Fields builders) and column + row
// management on the right, then the disabled Phase-2 "Run" action. Mutation
// actions are disabled for viewers; the underlying API also enforces this and
// surfaces 403s as toasts from the callers.

import Link from 'next/link'
import { useState } from 'react'
import type { Column, View } from '@cascade/core'
import { Button, Pill, Tag, Tooltip, useToast } from '@cascade/ui'
import { ViewControls } from './views/ViewControls'
import { ImportButton } from './csv/ImportButton'
import { downloadCsv, exportFilename, exportViewToCsv, visibleColumnsForView } from './csv/csvExport'
import { errorMessage } from '../../../../lib/ui'
import styles from '../table-surface.module.css'

interface Props {
  tableName: string
  rowCount: number | undefined
  rowCountLoading: boolean
  tableId: string
  columns: Column[]
  views: View[]
  activeViewId: string
  onChangeView: (id: string) => void
  writable: boolean
  onAddColumn: () => void
  onManageColumns: () => void
  onDeleteRows: () => void
  remountGrid: () => void
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}
function IconPlus() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function IconColumns() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}
function IconRows() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18" />
    </svg>
  )
}
function IconRun() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5l12 7-12 7Z" />
    </svg>
  )
}
function IconExport() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

export function GridToolbar({
  tableName,
  rowCount,
  rowCountLoading,
  tableId,
  columns,
  views,
  activeViewId,
  onChangeView,
  writable,
  onAddColumn,
  onManageColumns,
  onDeleteRows,
  remountGrid,
}: Props) {
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const view = views.find((v) => v.id === activeViewId)
      const cols = visibleColumnsForView(columns, view)
      const csv = await exportViewToCsv(tableId, cols, activeViewId)
      downloadCsv(exportFilename(tableName, view?.name), csv)
    } catch (e) {
      toast(errorMessage(e), { variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.lead}>
        <Link href="/tables" className={styles.back}>
          <IconBack />
          Tables
        </Link>
        <div className={styles.titleRow}>
          <span className={styles.name} title={tableName}>
            {tableName}
          </span>
          <Tag mono tone="brand" className={styles.countTag}>
            {rowCountLoading || rowCount === undefined ? '…' : `${rowCount.toLocaleString('en-US')} rows`}
          </Tag>
          {!writable && (
            <span className={styles.readOnlyPill}>
              <Pill status="cached">Read-only</Pill>
            </span>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <ViewControls
          tableId={tableId}
          columns={columns}
          views={views}
          activeViewId={activeViewId}
          writable={writable}
          onChangeView={onChangeView}
          remountGrid={remountGrid}
        />

        <span className={styles.divider} />

        <Button variant="secondary" size="sm" onClick={onAddColumn} disabled={!writable}>
          <IconPlus />
          Add column
        </Button>
        <Button variant="ghost" size="sm" onClick={onManageColumns}>
          <IconColumns />
          Columns
        </Button>
        <Button variant="ghost" size="sm" onClick={onDeleteRows} disabled={!writable}>
          <IconRows />
          Rows
        </Button>

        <span className={styles.divider} />

        <ImportButton tableId={tableId} columns={columns} writable={writable} remountGrid={remountGrid} />
        <Button variant="ghost" size="sm" onClick={handleExport} disabled={exporting}>
          <IconExport />
          {exporting ? 'Exporting…' : 'Export'}
        </Button>

        <span className={styles.divider} />

        <Tooltip content="Enrichment runs arrive in Phase 2.">
          <span className={styles.runWrap}>
            <Button variant="primary" size="sm" disabled>
              <IconRun />
              Run
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  )
}
