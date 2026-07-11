// Interaction test for the grid's undo/redo engine (useUndoRedo) — the command
// history behind Cmd/Ctrl+Z / Shift+Z and the HistoryControls strip. Each
// command carries its own undo/redo closures; the hook owns the two stacks,
// derives the enabled-state snapshot the controls render, and guards against
// overlapping async replays. We exercise it through renderHook so the assertions
// run against the real derived HistoryState, not a reimplementation.

import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MAX_HISTORY, useUndoRedo } from '@cascade/grid'

/** A command that records when its undo/redo fires, for ordering assertions. */
function cmd(label: string, log: string[]) {
  return {
    label,
    undo: () => {
      log.push(`undo:${label}`)
    },
    redo: () => {
      log.push(`redo:${label}`)
    },
  }
}

describe('useUndoRedo', () => {
  it('starts with both actions disabled and no labels', () => {
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.state.undoLabel).toBeNull()
    expect(result.current.state.redoLabel).toBeNull()
  })

  it('enables undo and surfaces the command label after a push', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.push(cmd('Edit cell', [])))

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.state.undoLabel).toBe('Edit cell')
  })

  it('undo replays the inverse and moves the command onto the redo stack', async () => {
    const log: string[] = []
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.push(cmd('Paste', log)))

    act(() => result.current.undo())

    await waitFor(() => expect(result.current.canRedo).toBe(true))
    expect(log).toEqual(['undo:Paste'])
    expect(result.current.canUndo).toBe(false)
    expect(result.current.state.redoLabel).toBe('Paste')
  })

  it('redo re-applies the most recently undone command', async () => {
    const log: string[] = []
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.push(cmd('Delete row', log)))
    act(() => result.current.undo())
    await waitFor(() => expect(result.current.canRedo).toBe(true))

    act(() => result.current.redo())
    await waitFor(() => expect(result.current.canUndo).toBe(true))

    expect(log).toEqual(['undo:Delete row', 'redo:Delete row'])
    expect(result.current.canRedo).toBe(false)
  })

  it('pushing a new command clears the redo stack', async () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.push(cmd('A', [])))
    act(() => result.current.undo())
    await waitFor(() => expect(result.current.canRedo).toBe(true))

    act(() => result.current.push(cmd('B', [])))

    expect(result.current.canRedo).toBe(false)
    expect(result.current.state.undoLabel).toBe('B')
  })

  it('clear() empties both stacks', async () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.push(cmd('A', [])))
    act(() => result.current.push(cmd('B', [])))
    act(() => result.current.undo())
    await waitFor(() => expect(result.current.canRedo).toBe(true))

    act(() => result.current.clear())

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('caps the undo stack at MAX_HISTORY, dropping the oldest command', async () => {
    const undone: number[] = []
    const { result } = renderHook(() => useUndoRedo())

    act(() => {
      // One more than the cap: the very first push (0) should be evicted.
      for (let i = 0; i <= MAX_HISTORY; i += 1) {
        result.current.push({
          label: `c${i}`,
          undo: () => {
            undone.push(i)
          },
          redo: () => {},
        })
      }
    })

    // Each undo settles over a few microtasks behind the busy-guard, so we flush
    // the microtask queue (not poll) between the serial undos to drain quickly.
    const flush = () =>
      act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

    let guard = 0
    while (result.current.canUndo && guard++ <= MAX_HISTORY + 5) {
      act(() => result.current.undo())
      await flush()
    }

    expect(undone).toHaveLength(MAX_HISTORY) // exactly the cap fired
    expect(undone).not.toContain(0) // the oldest was dropped
    expect(undone[0]).toBe(MAX_HISTORY) // most-recent-first order
  })

  it('keeps a command undoable when its inverse fails to persist', async () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() =>
      result.current.push({
        label: 'Edit cell',
        undo: () => Promise.reject(new Error('conflict')),
        redo: () => {},
      }),
    )

    act(() => result.current.undo())

    // The failed inverse is returned to the undo stack, not silently lost, and
    // never lands on the redo stack.
    await waitFor(() => expect(result.current.canUndo).toBe(true))
    expect(result.current.canRedo).toBe(false)
  })
})
