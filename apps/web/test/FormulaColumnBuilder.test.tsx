// Interaction test for the formula-column builder's live validation. The
// builder validates the expression client-side with the same evaluator the
// engine uses: a valid expression enables Save and shows an OK note; an invalid
// one surfaces a warning and disables Save.

import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { FormulaColumnBuilder } from '../app/(app)/tables/[tableId]/_components/formula/FormulaColumnBuilder'

function noop() {}

function renderBuilder() {
  return renderWithProviders(
    <FormulaColumnBuilder
      open
      onOpenChange={noop}
      tableId="t1"
      columns={[]}
      workspaceId="w1"
      column={null}
      onSaved={noop}
    />,
    { session: false },
  )
}

describe('FormulaColumnBuilder — validation', () => {
  it('starts with no validation verdict and lists the function help', () => {
    renderBuilder()
    expect(screen.queryByText('Expression is valid.')).toBeNull()
    expect(screen.queryByText('Check the expression')).toBeNull()
    // the function reference is always shown
    expect(screen.getByText(/IF · AND · OR/)).toBeTruthy()
  })

  it('accepts a valid example expression and enables Save', () => {
    renderBuilder()
    // clicking a curated example seeds a known-valid expression
    fireEvent.click(screen.getByRole('button', { name: 'YEAR({{Signed}})' }))

    expect(screen.getByText('Expression is valid.')).toBeTruthy()
    const save = screen.getByRole('button', { name: /Save formula column/ }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('warns on an invalid expression and disables Save', () => {
    renderBuilder()
    // The expression textarea is labelled by its visible "Expression" field label.
    const editor = screen.getByLabelText('Expression') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'IF(' } })

    // The validation error is announced inline at the field (role="alert").
    expect(screen.getByRole('alert')).toBeTruthy()
    const save = screen.getByRole('button', { name: /Save formula column/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })
})
