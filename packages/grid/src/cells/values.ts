// Bridges the typed cell value and the plain-string world of the overlay editor.
// The editor buffers a `draft` string; on commit the raw string is fed back
// through the @cascade/core column-type registry to validate + coerce.

import type { CascadeCellData } from './types'

/** The string an editor should show when it opens for `data`. */
export function editStringFor(data: CascadeCellData): string {
  const { value } = data
  switch (data.kind) {
    case 'number':
    case 'currency':
      return typeof value === 'number' ? String(value) : ''
    case 'singleSelect':
    case 'multiSelect':
      // Edited by typing labels; `display` already resolves ids → labels.
      return data.display
    case 'boolean':
    case 'status':
      return ''
    default:
      // text / longText / url / email / phone / date all store a string | null.
      return typeof value === 'string' ? value : ''
  }
}

/**
 * The raw string to validate on commit: the live draft if the user typed
 * anything, otherwise the cell's current editable string (a no-op edit).
 */
export function rawFromCell(data: CascadeCellData): string {
  return data.draft !== undefined ? data.draft : editStringFor(data)
}
