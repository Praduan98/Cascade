'use client'
import { useState, type ReactNode } from 'react'
import { Button } from '../Button'
import { Tag } from '../Tag'
import { ProvMono } from '../ProvChip'
import styles from './waterfall.module.css'

/** A provider reference for the step header (glyph square + name). */
export interface ProviderRef {
  glyph: ReactNode
  name: string
  /** Background of the monogram square (hex or token var). */
  color: string
  inkColor?: string
}

export interface WaterfallStepData {
  id: string
  provider: ProviderRef
  operation: string
  /** Input field names, joined with " · " in the map line. */
  inFields: string[]
  /** Output field names. */
  outFields: string[]
  /** Trailing note, e.g. "· else fall through". */
  outTail?: string
  /** Credit cost, e.g. "1 cr" — always visible. */
  cost: string
  /** Dollar cost, e.g. "~$0.008" — Admin only; omit to hide. */
  costUsd?: string
  /** The connector rendered AFTER this step (fall-through condition). */
  fallThrough?: { label: string; cond: string }
  /** The accepted / active step — highlighted brand. */
  active?: boolean
}

export interface WaterfallProps {
  /** Column / waterfall name, e.g. "find_work_email". */
  name: string
  /** Summary tag, e.g. "3 steps · est. ≤ 2 cr/row". */
  summary?: string
  steps: WaterfallStepData[]
  readOnly?: boolean
  onReorder?: (from: number, to: number) => void
  onRemoveStep?: (id: string) => void
  onEditStep?: (id: string) => void
  onAddStep?: () => void
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
function Cross() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function WaterfallConnector({ label, cond }: { label: string; cond: string }) {
  return (
    <div className={styles.connector}>
      <span className={styles.line} />
      <span>{label}</span>
      <span className={styles.cond}>{cond}</span>
    </div>
  )
}

export function WaterfallStep({
  step,
  index,
  total,
  readOnly,
  onReorder,
  onRemove,
  onEdit,
}: {
  step: WaterfallStepData
  index: number
  total: number
  readOnly?: boolean
  onReorder?: (from: number, to: number) => void
  onRemove?: (id: string) => void
  onEdit?: (id: string) => void
}) {
  const clickable = !readOnly && onEdit
  return (
    <div
      className={[styles.step, step.active ? styles.stepActive : ''].filter(Boolean).join(' ')}
      onClick={clickable ? () => onEdit?.(step.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onEdit?.(step.id)) : undefined}
    >
      <span className={styles.handle} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <div className={styles.body}>
        <div className={styles.pname}>
          <ProvMono bg={step.provider.color} color={step.provider.inkColor} decorative>
            {step.provider.glyph}
          </ProvMono>
          {step.provider.name} · {step.operation}
        </div>
        <div className={styles.pmap}>
          in <b>{step.inFields.join(' · ')}</b> → out <b>{step.outFields.join(' · ')}</b>
          {step.outTail ? ` ${step.outTail}` : ''}
        </div>
      </div>
      <div className={styles.right}>
        <div className={styles.cost}>
          <div className={styles.c}>{step.cost}</div>
          {step.costUsd ? <div className={styles.u}>{step.costUsd}</div> : null}
        </div>
        {!readOnly && (onReorder || onRemove) ? (
          <div className={styles.controls}>
            {onReorder ? (
              <>
                <button
                  type="button"
                  className={styles.ctrl}
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReorder(index, index - 1)
                  }}
                  aria-label={`Move ${step.provider.name} up`}
                >
                  <ChevronUp />
                </button>
                <button
                  type="button"
                  className={styles.ctrl}
                  disabled={index === total - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReorder(index, index + 1)
                  }}
                  aria-label={`Move ${step.provider.name} down`}
                >
                  <ChevronDown />
                </button>
              </>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                className={[styles.ctrl, styles.remove].join(' ')}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(step.id)
                }}
                aria-label={`Remove ${step.provider.name}`}
              >
                <Cross />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Waterfall({ name, summary, steps, readOnly, onReorder, onRemoveStep, onEditStep, onAddStep }: WaterfallProps) {
  // Announce reorder moves for screen readers.
  const [announce, setAnnounce] = useState('')
  const handleReorder = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= steps.length) return
    const moved = steps[from]
    onReorder(from, to)
    if (moved) setAnnounce(`Moved ${moved.provider.name} to step ${to + 1} of ${steps.length}`)
  }

  return (
    <div>
      <div className={styles.head}>
        <span className={styles.name}>{name}</span>
        {summary ? (
          <Tag mono tone="default">
            {summary}
          </Tag>
        ) : null}
      </div>
      <div className={styles.waterfall}>
        {steps.map((step, i) => (
          <div key={step.id}>
            <WaterfallStep
              step={step}
              index={i}
              total={steps.length}
              readOnly={readOnly}
              onReorder={onReorder ? handleReorder : undefined}
              onRemove={onRemoveStep}
              onEdit={onEditStep}
            />
            {step.fallThrough ? <WaterfallConnector label={step.fallThrough.label} cond={step.fallThrough.cond} /> : null}
          </div>
        ))}
      </div>
      {!readOnly && onAddStep ? (
        <Button variant="ghost" size="sm" className={styles.add} onClick={onAddStep}>
          + Add provider step
        </Button>
      ) : null}
      <span className={styles.sr} role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}
