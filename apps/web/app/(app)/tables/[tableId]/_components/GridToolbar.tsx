'use client'
// The grid toolbar: table identity + live row count on the left; the view
// switcher, filter/sort entry points, column + row management, and the disabled
// Phase-2 "Run" action on the right. Mutation actions are disabled for viewers;
// the underlying API also enforces this, surfaced as a toast by the callers.

import Link from 'next/link'
import type { View } from '@cascade/core'
import {
  Button,
  Pill,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Seg,
  Tag,
  Tooltip,
} from '@cascade/ui'
import styles from '../table-surface.module.css'

interface Props {
  tableName: string
  rowCount: number | undefined
  rowCountLoading: boolean
  views: View[]
  activeViewId: string
  onChangeView: (id: string) => void
  writable: boolean
  onAddColumn: () => void
  onManageColumns: () => void
  onDeleteRows: () => void
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}
function IconFilter() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
    </svg>
  )
}
function IconSort() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" />
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

export function GridToolbar({
  tableName,
  rowCount,
  rowCountLoading,
  views,
  activeViewId,
  onChangeView,
  writable,
  onAddColumn,
  onManageColumns,
  onDeleteRows,
}: Props) {
  const activeView = views.find((v) => v.id === activeViewId)

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
        {views.length > 1 ? (
          <Seg
            aria-label="View"
            value={activeViewId}
            onChange={onChangeView}
            options={views.map((v) => ({ value: v.id, label: v.name }))}
          />
        ) : (
          <span className={styles.viewLabel}>{activeView?.name ?? 'Grid view'}</span>
        )}

        <span className={styles.divider} />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              <IconFilter />
              Filter
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className={styles.hintPop}>
              <span className={styles.hintTitle}>Filters live in views</span>
              <span className={styles.hintBody}>
                Each saved view carries its own filter set. The visual filter builder comes online with Views.
              </span>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              <IconSort />
              Sort
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className={styles.hintPop}>
              <span className={styles.hintTitle}>Sorting lives in views</span>
              <span className={styles.hintBody}>
                Reorderable multi-column sort is saved per view and arrives with Views.
              </span>
            </div>
          </PopoverContent>
        </Popover>

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
