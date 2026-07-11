'use client'
// The filter builder. Presents a saved view's filters as a flat AND/OR group of
// typed conditions (column → operator → operand). Every edit is pushed to the
// parent via onCommit — structural changes immediately, operand keystrokes on a
// short debounce — so the grid + row count stay live. Operators come straight
// from each column type's registry, so a condition is always type-appropriate.

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
} from '@cascade/ui'
import { emptyFilter } from '@cascade/core'
import type { Column, FilterCondition, FilterGroup, View } from '@cascade/core'
import { OperandInput } from './OperandInput'
import {
  conditionsOf,
  defaultOperand,
  findOperator,
  makeCondition,
  operandKind,
  operatorsFor,
  toGroup,
} from './filterModel'
import styles from './views.module.css'

interface Props {
  columns: Column[]
  view: View | undefined
  writable: boolean
  onCommit: (filters: FilterGroup) => void
}

function IconFilter() {
  return (
    <svg className={styles.switcherIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
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

export function FilterPopover({ columns, view, writable, onCommit }: Props) {
  const [open, setOpen] = useState(false)
  const [conj, setConj] = useState<'and' | 'or'>('and')
  const [conds, setConds] = useState<FilterCondition[]>([])

  const viewId = view?.id
  const viewRef = useRef(view)
  viewRef.current = view
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Seed the draft from the active view whenever it changes or the panel opens.
  useEffect(() => {
    const g = viewRef.current?.filters ?? emptyFilter()
    setConj(g.conjunction)
    setConds(conditionsOf(g))
  }, [viewId, open])

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  function commitNow(nextConj: 'and' | 'or', nextConds: FilterCondition[]) {
    clearTimer()
    onCommitRef.current(toGroup(nextConj, nextConds))
  }
  function commitDebounced(nextConj: 'and' | 'or', nextConds: FilterCondition[]) {
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      onCommitRef.current(toGroup(nextConj, nextConds))
    }, 300)
  }

  function handleOpenChange(next: boolean) {
    if (!next && timer.current) commitNow(conj, conds) // flush a pending operand edit
    setOpen(next)
  }

  function setConjunction(next: 'and' | 'or') {
    setConj(next)
    commitNow(next, conds)
  }
  function changeColumn(index: number, columnId: string) {
    const col = columns.find((c) => c.id === columnId)
    if (!col) return
    const next = conds.slice()
    next[index] = makeCondition(col)
    setConds(next)
    commitNow(conj, next)
  }
  function changeOperator(index: number, opId: string) {
    const cur = conds[index]
    if (!cur) return
    const col = columns.find((c) => c.id === cur.columnId)
    if (!col) return
    const op = findOperator(col, opId)
    const operand = defaultOperand(operandKind(col, op))
    const cond: FilterCondition = { columnId: cur.columnId, op: opId }
    if (operand !== undefined) cond.operand = operand
    const next = conds.slice()
    next[index] = cond
    setConds(next)
    commitNow(conj, next)
  }
  function changeOperand(index: number, operand: unknown) {
    const cur = conds[index]
    if (!cur) return
    const next = conds.slice()
    next[index] = { ...cur, operand }
    setConds(next)
    commitDebounced(conj, next)
  }
  function addCondition() {
    const col = columns[0]
    if (!col) return
    const next = [...conds, makeCondition(col)]
    setConds(next)
    commitNow(conj, next)
  }
  function removeCondition(index: number) {
    const next = conds.filter((_, i) => i !== index)
    setConds(next)
    commitNow(conj, next)
  }
  function clearAll() {
    setConds([])
    commitNow(conj, [])
  }

  // While open the badge tracks the live draft; while closed it reflects the
  // persisted view so it stays accurate regardless of in-flight refetches.
  const count = open ? conds.length : conditionsOf(view?.filters ?? emptyFilter()).length
  const triggerCls = ['btn', 'btn-ghost', 'btn-sm', count > 0 ? styles.triggerActive : ''].filter(Boolean).join(' ')

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerCls}>
          <IconFilter />
          Filter
          {count > 0 && <span className={styles.count}>{count}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" showArrow={false} style={{ width: 'min(94vw, 480px)', maxWidth: 'min(94vw, 480px)' }}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Filter</span>
            <span className={styles.panelHint}>
              {count === 0
                ? 'Show only the rows that meet every condition you add.'
                : 'Rows must match ' + (conj === 'and' ? 'all' : 'any') + ' of these conditions.'}
            </span>
          </div>

          {conds.length > 0 && (
            <div className={styles.rows}>
              {conds.map((cond, i) => {
                const col = columns.find((c) => c.id === cond.columnId) ?? columns[0]
                if (!col) return null
                const ops = operatorsFor(col)
                const op = findOperator(col, cond.op) ?? ops[0]
                return (
                  <div key={i} className={styles.condRow}>
                    {i === 0 ? (
                      <span className={styles.conjStatic}>Where</span>
                    ) : i === 1 ? (
                      <Select
                        className={styles.conj}
                        aria-label="Conjunction"
                        disabled={!writable}
                        value={conj}
                        onChange={(e) => setConjunction(e.target.value as 'and' | 'or')}
                      >
                        <option value="and">And</option>
                        <option value="or">Or</option>
                      </Select>
                    ) : (
                      <span className={styles.conjStatic}>{conj === 'and' ? 'And' : 'Or'}</span>
                    )}

                    <Select
                      className={styles.growCol}
                      aria-label="Column"
                      disabled={!writable}
                      value={col.id}
                      onChange={(e) => changeColumn(i, e.target.value)}
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>

                    <Select
                      className={styles.grow}
                      aria-label="Operator"
                      disabled={!writable}
                      value={op?.id ?? ''}
                      onChange={(e) => changeOperator(i, e.target.value)}
                    >
                      {ops.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>

                    <OperandInput
                      column={col}
                      operator={op}
                      operand={cond.operand}
                      disabled={!writable}
                      onChange={(v) => changeOperand(i, v)}
                    />

                    <button
                      type="button"
                      className={['iconBtn', styles.align].join(' ')}
                      aria-label="Remove condition"
                      disabled={!writable}
                      onClick={() => removeCondition(i)}
                    >
                      <IconX />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {conds.length === 0 && (
            <p className={styles.emptyHint}>No filters yet — every row is shown.</p>
          )}

          <div className={styles.panelFoot}>
            <Button variant="secondary" size="sm" onClick={addCondition} disabled={!writable || columns.length === 0}>
              + Add condition
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
