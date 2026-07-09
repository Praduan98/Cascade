'use client'
// The sort builder. A priority-ordered list of { column, direction } specs — the
// core comparator applies them top-to-bottom and is type-aware (numbers sort
// numerically, dates chronologically, selects by option order). Rows can be
// reordered to change precedence and flipped asc/desc; every edit commits to the
// active view so the grid re-sorts live.

import { useEffect, useRef, useState } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger, Seg, Select } from '@cascade/ui'
import type { Column, SortSpec, View } from '@cascade/core'
import styles from './views.module.css'

interface Props {
  columns: Column[]
  view: View | undefined
  writable: boolean
  onCommit: (sorts: SortSpec[]) => void
}

function IconSort() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 15, height: 15, marginRight: 6, verticalAlign: -2 }}>
      <path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" />
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
function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function SortPopover({ columns, view, writable, onCommit }: Props) {
  const [open, setOpen] = useState(false)
  const [sorts, setSorts] = useState<SortSpec[]>([])

  const viewId = view?.id
  const viewRef = useRef(view)
  viewRef.current = view
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    setSorts((viewRef.current?.sorts ?? []).map((s) => ({ ...s })))
  }, [viewId, open])

  function commit(next: SortSpec[]) {
    setSorts(next)
    onCommitRef.current(next)
  }

  const usedIds = new Set(sorts.map((s) => s.columnId))
  const firstUnused = columns.find((c) => !usedIds.has(c.id))

  function addSort() {
    if (!firstUnused) return
    commit([...sorts, { columnId: firstUnused.id, dir: 'asc' }])
  }
  function changeColumn(index: number, columnId: string) {
    const next = sorts.slice()
    const cur = next[index]
    if (!cur) return
    next[index] = { columnId, dir: cur.dir }
    commit(next)
  }
  function changeDir(index: number, dir: 'asc' | 'desc') {
    const next = sorts.slice()
    const cur = next[index]
    if (!cur) return
    next[index] = { columnId: cur.columnId, dir }
    commit(next)
  }
  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= sorts.length) return
    const next = sorts.slice()
    const moved = next.splice(index, 1)[0]
    if (!moved) return
    next.splice(target, 0, moved)
    commit(next)
  }
  function remove(index: number) {
    commit(sorts.filter((_, i) => i !== index))
  }
  function clearAll() {
    commit([])
  }

  // Live draft length while open; persisted view length while closed.
  const count = open ? sorts.length : view?.sorts?.length ?? 0
  const triggerCls = ['btn', 'btn-ghost', 'btn-sm', count > 0 ? styles.triggerActive : ''].filter(Boolean).join(' ')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerCls}>
          <IconSort />
          Sort
          {count > 0 && <span className={styles.count}>{count}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" showArrow={false} style={{ width: 'min(94vw, 440px)', maxWidth: 'min(94vw, 440px)' }}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Sort</span>
            <span className={styles.panelHint}>
              {count === 0 ? 'Order rows by one or more columns.' : 'Applied top to bottom — the first is the primary sort.'}
            </span>
          </div>

          {count > 0 && (
            <div className={styles.rows}>
              {sorts.map((s, i) => {
                // Options: unused columns plus the one this row already picked.
                const available = columns.filter((c) => !usedIds.has(c.id) || c.id === s.columnId)
                return (
                  <div key={i} className={styles.sortRow}>
                    <div className={styles.priority}>
                      <button type="button" aria-label="Higher priority" disabled={!writable || i === 0} onClick={() => move(i, -1)}>
                        <ChevronUp />
                      </button>
                      <button type="button" aria-label="Lower priority" disabled={!writable || i === sorts.length - 1} onClick={() => move(i, 1)}>
                        <ChevronDown />
                      </button>
                    </div>
                    <Select
                      className={styles.sortCol}
                      aria-label="Sort column"
                      disabled={!writable}
                      value={s.columnId}
                      onChange={(e) => changeColumn(i, e.target.value)}
                    >
                      {available.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <div className={styles.dirSeg}>
                      <Seg
                        aria-label="Direction"
                        value={s.dir}
                        onChange={(v) => writable && changeDir(i, v)}
                        options={[
                          { value: 'asc', label: 'A→Z' },
                          { value: 'desc', label: 'Z→A' },
                        ]}
                      />
                    </div>
                    <button type="button" className={styles.removeBtn} aria-label="Remove sort" disabled={!writable} onClick={() => remove(i)}>
                      <IconX />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {count === 0 && <p className={styles.emptyHint}>No sorts yet — rows keep their natural order.</p>}

          <div className={styles.panelFoot}>
            <Button variant="secondary" size="sm" onClick={addSort} disabled={!writable || !firstUnused}>
              + Add sort
            </Button>
            <span className={styles.footSpacer} />
            {!writable ? (
              <span className={styles.roHint}>Read-only</span>
            ) : (
              <Button variant="ghost" size="sm" onClick={clearAll} disabled={count === 0}>
                Clear all
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
