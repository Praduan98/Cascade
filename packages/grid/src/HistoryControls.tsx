'use client'
// The visible undo/redo control strip rendered inside the grid container. It is
// a thin presentational shell over the history state — the parent owns the
// stacks (see useUndoRedo) and simply passes the enabled flags + handlers. The
// same handlers back the Cmd/Ctrl+Z shortcuts and the imperative handle, so the
// button, the keyboard, and any relocated controls stay in lockstep.

import type { MouseEvent } from 'react'
import styles from './HistoryControls.module.css'

export interface HistoryControlsProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** Tooltip hints (e.g. the label of the operation each action would affect). */
  undoLabel?: string | null
  redoLabel?: string | null
  className?: string
}

// Down/left curved arrow (undo) and its mirror (redo), drawn on a 16px grid.
function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 6.5H10a3 3 0 0 1 0 6H6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.75 4 3.25 6.5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12.5 6.5H6a3 3 0 0 0 0 6h3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.25 4l2.5 2.5-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The grid canvas steals focus on mousedown; keep it so shortcuts keep working.
const keepFocus = (e: MouseEvent) => e.preventDefault()

export function HistoryControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
  className,
}: HistoryControlsProps) {
  return (
    <div className={[styles.strip, className].filter(Boolean).join(' ')} role="group" aria-label="Undo and redo">
      <button
        type="button"
        className={styles.btn}
        disabled={!canUndo}
        onMouseDown={keepFocus}
        onClick={onUndo}
        title={canUndo ? (undoLabel ? `Undo ${undoLabel.toLowerCase()}` : 'Undo') : 'Nothing to undo'}
        aria-label={undoLabel ? `Undo ${undoLabel.toLowerCase()}` : 'Undo'}
      >
        <UndoIcon />
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={styles.btn}
        disabled={!canRedo}
        onMouseDown={keepFocus}
        onClick={onRedo}
        title={canRedo ? (redoLabel ? `Redo ${redoLabel.toLowerCase()}` : 'Redo') : 'Nothing to redo'}
        aria-label={redoLabel ? `Redo ${redoLabel.toLowerCase()}` : 'Redo'}
      >
        <RedoIcon />
      </button>
    </div>
  )
}
