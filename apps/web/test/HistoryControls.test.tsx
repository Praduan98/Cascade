// Interaction test for the grid's visible undo/redo strip (HistoryControls) —
// the presentational shell over the history state. It must disable each button
// when there's nothing to undo/redo, invoke the right handler on click, and
// surface the operation label in its accessible name/tooltip so the button, the
// keyboard shortcut, and any relocated controls stay in lockstep.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HistoryControls } from '@cascade/grid'

describe('HistoryControls', () => {
  it('disables both buttons when there is nothing to undo or redo', () => {
    render(<HistoryControls canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true)
  })

  it('fires the matching handler when an enabled button is clicked', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(<HistoryControls canUndo canRedo onUndo={onUndo} onRedo={onRedo} undoLabel="Paste" redoLabel="Edit cell" />)

    fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    fireEvent.click(screen.getByRole('button', { name: /redo/i }))

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('folds the operation label into each button\'s accessible name', () => {
    render(<HistoryControls canUndo canRedo onUndo={() => {}} onRedo={() => {}} undoLabel="Paste" redoLabel="Delete row" />)

    // labels are lower-cased into "Undo paste" / "Redo delete row"
    expect(screen.getByRole('button', { name: 'Undo paste' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Redo delete row' })).toBeTruthy()
  })

  it('does not fire the handler for a disabled button', () => {
    const onRedo = vi.fn()
    render(<HistoryControls canUndo canRedo={false} onUndo={() => {}} onRedo={onRedo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(onRedo).not.toHaveBeenCalled()
  })
})
