'use client'
// View-level column visibility + order. Distinct from the structural "Columns"
// manager (which reorders/retypes the table's actual columns): this edits only
// THIS view's ColumnState — which fields are shown and in what order — and
// persists it back onto the view. Seeded from the view's columnState, reconciled
// against the live column set so newly-added columns always appear.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@cascade/ui'
import { getColumnType } from '@cascade/core'
import type { Column, ColumnState, View } from '@cascade/core'
import styles from './views.module.css'

interface Props {
  columns: Column[]
  view: View | undefined
  writable: boolean
  onCommit: (columnState: ColumnState[]) => void
}

/** Merge a view's saved column state with the live columns, in view order. */
function seed(columns: Column[], view: View | undefined): ColumnState[] {
  const saved = view?.columnState ?? []
  const byId = new Map(saved.map((s) => [s.columnId, s]))
  const ordered = saved
    .filter((s) => columns.some((c) => c.id === s.columnId))
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ ...s }))
  const missing = columns.filter((c) => !byId.has(c.id))
  const merged = [
    ...ordered,
    ...missing.map((c) => ({ columnId: c.id, visible: true, position: 0, width: c.width })),
  ]
  return merged.map((s, i) => ({ ...s, position: i }))
}

function IconFields() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 15, height: 15, marginRight: 6, verticalAlign: -2 }}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}
function EyeOn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}
function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4-.9M9.5 9.6a2.6 2.6 0 0 0 3.6 3.6" />
    </svg>
  )
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

export function FieldsPopover({ columns, view, writable, onCommit }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ColumnState[]>([])

  const viewId = view?.id
  const viewRef = useRef(view)
  viewRef.current = view
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    setState(seed(columnsRef.current, viewRef.current))
  }, [viewId, open, columns])

  const colsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns])
  const visibleCount = state.filter((s) => s.visible).length
  const hiddenCount = state.length - visibleCount

  function commit(next: ColumnState[]) {
    const renumbered = next.map((s, i) => ({ ...s, position: i }))
    setState(renumbered)
    onCommitRef.current(renumbered)
  }
  function toggle(index: number) {
    const cur = state[index]
    if (!cur) return
    if (cur.visible && visibleCount <= 1) return // keep at least one field shown
    const next = state.slice()
    next[index] = { ...cur, visible: !cur.visible }
    commit(next)
  }
  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= state.length) return
    const next = state.slice()
    const moved = next.splice(index, 1)[0]
    if (!moved) return
    next.splice(target, 0, moved)
    commit(next)
  }
  function showAll() {
    commit(state.map((s) => ({ ...s, visible: true })))
  }

  // Badge reflects the live draft while open, the persisted view while closed.
  const savedHidden = (view?.columnState ?? []).filter(
    (s) => !s.visible && columns.some((c) => c.id === s.columnId),
  ).length
  const triggerHidden = open ? hiddenCount : savedHidden
  const triggerCls = ['btn', 'btn-ghost', 'btn-sm', triggerHidden > 0 ? styles.triggerActive : ''].filter(Boolean).join(' ')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerCls}>
          <IconFields />
          Fields
          {triggerHidden > 0 && <span className={styles.count}>{triggerHidden}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" showArrow={false} style={{ width: 'min(94vw, 420px)', maxWidth: 'min(94vw, 420px)' }}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Fields</span>
            <span className={styles.panelHint}>Show, hide and reorder the fields in this view.</span>
          </div>

          <div className={styles.rows}>
            {state.map((s, i) => {
              const col = colsById.get(s.columnId)
              if (!col) return null
              const def = getColumnType(col.type)
              const lockedOn = s.visible && visibleCount <= 1
              return (
                <div key={s.columnId} className={[styles.fieldRow, s.visible ? '' : styles.off].filter(Boolean).join(' ')}>
                  <button
                    type="button"
                    className={[styles.eyeBtn, s.visible ? styles.visible : ''].filter(Boolean).join(' ')}
                    aria-label={s.visible ? `Hide ${col.name}` : `Show ${col.name}`}
                    aria-pressed={s.visible}
                    disabled={!writable || lockedOn}
                    onClick={() => toggle(i)}
                  >
                    {s.visible ? <EyeOn /> : <EyeOff />}
                  </button>
                  <div className={styles.fieldMeta}>
                    <span className={styles.fieldBadge}>{def.typeBadge}</span>
                    <span className={styles.fieldName}>{col.name}</span>
                  </div>
                  <div className={styles.priority}>
                    <button type="button" aria-label="Move up" disabled={!writable || i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp />
                    </button>
                    <button type="button" aria-label="Move down" disabled={!writable || i === state.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className={styles.panelFoot}>
            <span className={styles.roHint}>
              {visibleCount} shown{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
            </span>
            <span className={styles.footSpacer} />
            {writable && (
              <Button variant="ghost" size="sm" onClick={showAll} disabled={hiddenCount === 0}>
                Show all
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
