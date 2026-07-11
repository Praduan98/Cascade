// Interaction test for the Add-column dialog's smart-type handoff. Picking a
// plain type keeps the inline "Add column" affordance; picking an operation type
// (ai/agent/http/formula) swaps in an explanatory note and a "Configure…" CTA
// that hands off to the dedicated builder via onRequestSmartColumn — without
// persisting a column itself.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { AddColumnDialog } from '../app/(app)/tables/[tableId]/_components/AddColumnDialog'

function noop() {}

describe('AddColumnDialog — smart-type handoff', () => {
  it('offers the inline "Add column" action for a plain type', () => {
    renderWithProviders(
      <AddColumnDialog open onOpenChange={noop} tableId="t1" onAdded={noop} />,
      { session: false },
    )
    expect(screen.getByRole('button', { name: 'Add column' })).toBeTruthy()
    // no smart-type note yet
    expect(screen.queryByText(/hand off to the .* builder|continue to the AI builder/i)).toBeNull()
  })

  it('swaps to a Configure CTA + note when an operation type is picked', () => {
    renderWithProviders(
      <AddColumnDialog open onOpenChange={noop} tableId="t1" onAdded={noop} />,
      { session: false },
    )
    fireEvent.click(screen.getByRole('radio', { name: /AI$/ }))

    expect(screen.getByRole('button', { name: /Configure AI/ })).toBeTruthy()
    expect(screen.getByText(/AI columns use a prompt and a model/i)).toBeTruthy()
    // the plain add action is gone
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull()
  })

  it('hands the picked type + trimmed name to onRequestSmartColumn', async () => {
    const onRequest = vi.fn()
    renderWithProviders(
      <AddColumnDialog
        open
        onOpenChange={noop}
        tableId="t1"
        onAdded={noop}
        onRequestSmartColumn={onRequest}
      />,
      { session: false },
    )
    fireEvent.click(screen.getByRole('radio', { name: /AI$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Configure AI/ }))

    // handoff is deferred a tick so the two focus traps never collide
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('ai', ''))
  })
})
