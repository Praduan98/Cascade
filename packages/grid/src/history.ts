'use client'
// A small command-history engine for the grid's undoable mutations (cell edits,
// paste, row add, row delete). Each command carries its own `undo`/`redo`
// closures — the caller applies the forward change eagerly and hands us the
// inverse, so undo simply replays it through the same optimistic-plus-persist
// data path. The stacks live in refs (mutating them must never trigger a
// render); a single `HistoryState` snapshot drives the visible controls, the
// optional `onHistoryChange` callback, and the imperative handle.

import { useCallback, useRef, useState } from 'react'

/** One reversible operation. `undo`/`redo` may persist asynchronously. */
export interface GridCommand {
  /** Human label for tooltips (e.g. "Edit cell", "Paste", "Delete row"). */
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

/** A snapshot of what the undo/redo controls should show. */
export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  /** Label of the operation the next undo would reverse (for tooltips). */
  undoLabel: string | null
  /** Label of the operation the next redo would re-apply. */
  redoLabel: string | null
}

export interface UndoRedoApi {
  /** Record a freshly-applied command; clears the redo stack. */
  push: (command: GridCommand) => void
  /** Reverse the most recent command (no-op when the undo stack is empty). */
  undo: () => void
  /** Re-apply the most recently undone command. */
  redo: () => void
  /** Drop all history (call when the table/view changes). */
  clear: () => void
  canUndo: boolean
  canRedo: boolean
  state: HistoryState
}

/** History depth. The FSD asks for ≥ 50; we keep a generous window. */
export const MAX_HISTORY = 100

const EMPTY: HistoryState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }

/**
 * Undo/redo command stacks. `onChange` fires whenever the derived
 * enabled-state or top-of-stack labels change — used to notify a parent that
 * may relocate the controls.
 */
export function useUndoRedo(onChange?: (state: HistoryState) => void): UndoRedoApi {
  const undoStack = useRef<GridCommand[]>([])
  const redoStack = useRef<GridCommand[]>([])
  // Guards against overlapping async undo/redo (e.g. a held-down shortcut).
  const busy = useRef(false)
  const [state, setState] = useState<HistoryState>(EMPTY)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const sync = useCallback(() => {
    const u = undoStack.current
    const r = redoStack.current
    const next: HistoryState = {
      canUndo: u.length > 0,
      canRedo: r.length > 0,
      undoLabel: u.length > 0 ? u[u.length - 1]!.label : null,
      redoLabel: r.length > 0 ? r[r.length - 1]!.label : null,
    }
    setState((prev) =>
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.undoLabel === next.undoLabel &&
      prev.redoLabel === next.redoLabel
        ? prev
        : next,
    )
    onChangeRef.current?.(next)
  }, [])

  const push = useCallback(
    (command: GridCommand) => {
      undoStack.current.push(command)
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
      redoStack.current = []
      sync()
    },
    [sync],
  )

  const undo = useCallback(() => {
    if (busy.current) return
    const command = undoStack.current.pop()
    if (!command) return
    busy.current = true
    sync()
    Promise.resolve()
      .then(() => command.undo())
      .then(
        () => {
          redoStack.current.push(command)
        },
        () => {
          // The inverse failed to persist — keep it undoable rather than lose it.
          undoStack.current.push(command)
        },
      )
      .finally(() => {
        busy.current = false
        sync()
      })
  }, [sync])

  const redo = useCallback(() => {
    if (busy.current) return
    const command = redoStack.current.pop()
    if (!command) return
    busy.current = true
    sync()
    Promise.resolve()
      .then(() => command.redo())
      .then(
        () => {
          undoStack.current.push(command)
        },
        () => {
          redoStack.current.push(command)
        },
      )
      .finally(() => {
        busy.current = false
        sync()
      })
  }, [sync])

  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    sync()
  }, [sync])

  return { push, undo, redo, clear, canUndo: state.canUndo, canRedo: state.canRedo, state }
}
