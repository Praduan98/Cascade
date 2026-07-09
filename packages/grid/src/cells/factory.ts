// Factories that turn a (column, value) pair into a Cascade custom grid cell,
// and build StatusCell placeholders for unloaded rows. Display strings and chip
// resolution go through the @cascade/core column-type registry so the grid
// stays byte-for-byte consistent with the rest of the app.

import { GridCellKind } from '@glideapps/glide-data-grid'
import type { CellValue, Column, MultiSelectConfig, SingleSelectConfig } from '@cascade/core'
import { columnTypeRegistry } from '@cascade/core'
import type { CascadeCell, CascadeCellData, CellStatus, Chip } from './types'

const EMDASH = '—'

function custom(data: CascadeCellData, allowOverlay: boolean, copyData: string): CascadeCell {
  return { kind: GridCellKind.Custom, allowOverlay, copyData, data }
}

/** Build the correct custom cell for a column's typed value. */
export function makeCell(column: Column, value: CellValue): CascadeCell {
  const def = columnTypeRegistry[column.type]
  const empty = def.isEmpty(value)
  const copyData = def.toCsv(value, column.config)
  const base = { columnId: column.id, value, config: column.config }

  switch (column.type) {
    case 'number':
    case 'currency': {
      const display = empty ? EMDASH : def.formatDisplay(value, column.config)
      return custom({ ...base, kind: column.type, display, muted: empty, numeric: true }, true, copyData)
    }

    case 'url':
    case 'email': {
      const display = empty ? EMDASH : def.formatDisplay(value, column.config)
      return custom({ ...base, kind: column.type, display, muted: empty, link: !empty }, true, copyData)
    }

    case 'boolean': {
      const checked = typeof value === 'boolean' ? value : null
      const display = checked === true ? 'Yes' : checked === false ? 'No' : ''
      return custom({ ...base, kind: 'boolean', display, checked }, false, copyData)
    }

    case 'singleSelect': {
      const options = (column.config as SingleSelectConfig).options
      const opt = typeof value === 'string' ? options.find((o) => o.id === value) : undefined
      const chips: Chip[] = opt ? [{ label: opt.label, color: opt.color }] : []
      return custom(
        { ...base, kind: 'singleSelect', display: opt ? opt.label : EMDASH, chips, muted: !opt },
        true,
        copyData,
      )
    }

    case 'multiSelect': {
      const options = (column.config as MultiSelectConfig).options
      const ids = Array.isArray(value) ? value : []
      const chips: Chip[] = ids.flatMap((id) => {
        const o = options.find((x) => x.id === id)
        return o ? [{ label: o.label, color: o.color }] : []
      })
      const display = chips.map((c) => c.label).join(', ')
      return custom({ ...base, kind: 'multiSelect', display, chips, muted: chips.length === 0 }, true, copyData)
    }

    default: {
      // text / longText / phone / date — plain left-aligned text.
      const display = empty ? EMDASH : def.formatDisplay(value, column.config)
      return custom({ ...base, kind: column.type, display, muted: empty }, true, copyData)
    }
  }
}

export interface StatusCellOptions {
  /** Placeholder text next to the dot (ignored while `loading`). */
  text?: string
  /** Render the text muted. */
  muted?: boolean
}

/**
 * A StatusCell. With no status (or `loading`) it renders the shimmer skeleton
 * used for not-yet-loaded rows. `columnId` is carried for symmetry with real
 * cells; status cells are never editable.
 */
export function makeStatusCell(columnId: string, status: CellStatus = 'loading', opts: StatusCellOptions = {}): CascadeCell {
  const data: CascadeCellData = {
    kind: 'status',
    columnId,
    value: null,
    display: opts.text ?? '',
    config: { type: 'text' },
    status,
    muted: opts.muted ?? true,
  }
  return { kind: GridCellKind.Custom, allowOverlay: false, copyData: '', data }
}
