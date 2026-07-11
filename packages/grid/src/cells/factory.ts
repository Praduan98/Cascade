// Factories that turn a (column, value) pair into a Cascade custom grid cell,
// and build StatusCell placeholders for unloaded rows. Display strings and chip
// resolution go through the @cascade/core column-type registry so the grid
// stays byte-for-byte consistent with the rest of the app.

import { GridCellKind } from '@glideapps/glide-data-grid'
import type { Cell, CellValue, Column, MultiSelectConfig, SingleSelectConfig } from '@cascade/core'
import { columnTypeRegistry, readAgent, readAi, readEnrichment, readFormula, readHttp } from '@cascade/core'
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
      // text / longText / phone / date / ai / agent / http / formula — plain
      // left-aligned text. The operation column kinds (ai/agent/http/formula) have
      // no dedicated renderer (they store text), so they render through the
      // long-text renderer; their intelligence lives in the status cell paths below.
      const display = empty ? EMDASH : def.formatDisplay(value, column.config)
      const textKinds = new Set(['ai', 'agent', 'http', 'formula'])
      const renderKind = textKinds.has(column.type) ? 'longText' : column.type
      return custom({ ...base, kind: renderKind, display, muted: empty }, true, copyData)
    }
  }
}

/**
 * Build the cell for an enrichment (anchor) column, driven by `cell.meta.enrichment`.
 * Un-enriched cells render as their plain typed value (manual entry or blank);
 * enriched cells render the six-state status machine, stashing the provenance
 * for the click → provenance popover.
 */
export function makeEnrichCell(column: Column, cell: Cell | undefined): CascadeCell {
  const meta = cell ? readEnrichment(cell.meta) : undefined
  const value = cell?.value ?? null
  if (!meta) return makeCell(column, value)

  const def = columnTypeRegistry[column.type]
  const copyData = def.toCsv(value, column.config)
  const base = { columnId: column.id, value, config: column.config, kind: 'status' as const, enrichment: meta }

  const build = (data: CascadeCellData): CascadeCell => ({ kind: GridCellKind.Custom, allowOverlay: false, copyData, data })

  switch (meta.status) {
    case 'success':
    case 'cached': {
      const empty = def.isEmpty(value)
      return build({ ...base, status: meta.status, display: empty ? EMDASH : def.formatDisplay(value, column.config), muted: empty })
    }
    case 'running':
      return build({ ...base, status: 'running', display: '', muted: true })
    case 'empty':
      return build({ ...base, status: 'empty', display: meta.reason ?? 'no match found', muted: true })
    case 'failed':
      return build({ ...base, status: 'failed', display: meta.reason ?? 'failed', muted: true })
    default:
      return build({ ...base, status: 'queued', display: 'queued', muted: true })
  }
}

/**
 * Build the cell for an AI (anchor) column, driven by `cell.meta.ai`. Mirrors
 * `makeEnrichCell` exactly — un-generated cells render as their plain typed value;
 * generated cells render the same six-state status machine (reusing the shared
 * statusCellRenderer), stashing the AI provenance for the click → popover.
 */
export function makeAiCell(column: Column, cell: Cell | undefined): CascadeCell {
  const meta = cell ? readAi(cell.meta) : undefined
  const value = cell?.value ?? null
  if (!meta) return makeCell(column, value)

  const def = columnTypeRegistry[column.type]
  const copyData = def.toCsv(value, column.config)
  const base = { columnId: column.id, value, config: column.config, kind: 'status' as const, ai: meta }

  const build = (data: CascadeCellData): CascadeCell => ({ kind: GridCellKind.Custom, allowOverlay: false, copyData, data })

  switch (meta.status) {
    case 'success':
    case 'cached': {
      const empty = def.isEmpty(value)
      return build({ ...base, status: meta.status, display: empty ? EMDASH : def.formatDisplay(value, column.config), muted: empty })
    }
    case 'running':
      return build({ ...base, status: 'running', display: '', muted: true })
    case 'empty':
      return build({ ...base, status: 'empty', display: meta.reason ?? 'no result', muted: true })
    case 'failed':
      return build({ ...base, status: 'failed', display: meta.reason ?? 'failed', muted: true })
    default:
      return build({ ...base, status: 'queued', display: 'queued', muted: true })
  }
}

/** Agent (anchor) column cell, driven by `cell.meta.agent`. Mirrors makeAiCell. */
export function makeAgentCell(column: Column, cell: Cell | undefined): CascadeCell {
  const meta = cell ? readAgent(cell.meta) : undefined
  const value = cell?.value ?? null
  if (!meta) return makeCell(column, value)

  const def = columnTypeRegistry[column.type]
  const copyData = def.toCsv(value, column.config)
  const base = { columnId: column.id, value, config: column.config, kind: 'status' as const, agent: meta }
  const build = (data: CascadeCellData): CascadeCell => ({ kind: GridCellKind.Custom, allowOverlay: false, copyData, data })

  switch (meta.status) {
    case 'success':
    case 'cached': {
      const empty = def.isEmpty(value)
      return build({ ...base, status: meta.status, display: empty ? EMDASH : def.formatDisplay(value, column.config), muted: empty })
    }
    case 'running':
      return build({ ...base, status: 'running', display: '', muted: true })
    case 'empty':
      return build({ ...base, status: 'empty', display: meta.reason ?? 'no result', muted: true })
    case 'failed':
      return build({ ...base, status: 'failed', display: meta.reason ?? 'failed', muted: true })
    default:
      return build({ ...base, status: 'queued', display: 'queued', muted: true })
  }
}

/** HTTP (anchor) column cell, driven by `cell.meta.http`. Mirrors makeAiCell. */
export function makeHttpCell(column: Column, cell: Cell | undefined): CascadeCell {
  const meta = cell ? readHttp(cell.meta) : undefined
  const value = cell?.value ?? null
  if (!meta) return makeCell(column, value)

  const def = columnTypeRegistry[column.type]
  const copyData = def.toCsv(value, column.config)
  const base = { columnId: column.id, value, config: column.config, kind: 'status' as const, http: meta }
  const build = (data: CascadeCellData): CascadeCell => ({ kind: GridCellKind.Custom, allowOverlay: false, copyData, data })

  switch (meta.status) {
    case 'success':
    case 'cached': {
      const empty = def.isEmpty(value)
      return build({ ...base, status: meta.status, display: empty ? EMDASH : def.formatDisplay(value, column.config), muted: empty })
    }
    case 'running':
      return build({ ...base, status: 'running', display: '', muted: true })
    case 'empty':
      return build({ ...base, status: 'empty', display: meta.reason ?? 'no value', muted: true })
    case 'failed':
      return build({ ...base, status: 'failed', display: meta.reason ?? `HTTP ${meta.statusCode ?? 'error'}`, muted: true })
    default:
      return build({ ...base, status: 'queued', display: 'queued', muted: true })
  }
}

/**
 * Formula (anchor) column cell, driven by `cell.meta.formula`. A computed value
 * renders as plain text (reusing makeCell); an error renders through the shared
 * status renderer as a Failed cell carrying the message. Never directly editable.
 */
export function makeFormulaCell(column: Column, cell: Cell | undefined): CascadeCell {
  const meta = cell ? readFormula(cell.meta) : undefined
  const value = cell?.value ?? null
  if (meta?.status === 'error') {
    const base = { columnId: column.id, value, config: column.config, kind: 'status' as const }
    return { kind: GridCellKind.Custom, allowOverlay: false, copyData: '', data: { ...base, status: 'failed', display: meta.error ?? 'formula error', muted: true, formulaError: meta.error } }
  }
  // A computed value renders exactly like a plain text cell, but non-editable.
  const text = makeCell(column, value)
  return { ...text, allowOverlay: false }
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
