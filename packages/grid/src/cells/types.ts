// The shared data shape carried by every Cascade custom grid cell.
//
// Glide has one cell kind for anything we draw ourselves (`GridCellKind.Custom`)
// and distinguishes renderers by inspecting `cell.data`. We give every cell the
// same `CascadeCellData` interface and discriminate on `data.kind` — one
// CustomRenderer per column type narrows to its own kind in `isMatch`.

import type { CustomCell } from '@glideapps/glide-data-grid'
import type { AgentCellMeta, AiCellMeta, CellValue, ColumnConfig, ColumnType, EnrichmentCellMeta, HttpCellMeta } from '@cascade/core'
import type { StatusKey } from '../gridPalette'

/** Enrichment status shown by StatusCell — the six FSD states plus a loading skeleton. */
export type CellStatus = StatusKey | 'loading'

/** Discriminator: mirrors the 11 column types, plus the forward-compat 'status'. */
export type CascadeKind = ColumnType | 'status'

/** A resolved select chip (label + hex colour) ready to paint. */
export interface Chip {
  label: string
  color: string
}

export interface CascadeCellData {
  /** Brands the cell as ours and selects the renderer. */
  readonly kind: CascadeKind
  /** The column this cell belongs to (needed to re-validate on edit). */
  readonly columnId: string
  /** The typed stored value (as it lives in @cascade/data). */
  readonly value: CellValue
  /** Pre-formatted display string (via the column-type registry). */
  readonly display: string
  /** The owning column's config — used by the overlay editor + chip resolution. */
  readonly config: ColumnConfig
  /** Resolved chips for single/multi-select cells. */
  readonly chips?: readonly Chip[]
  /** Render numeric: right aligned, mono/tabular font. */
  readonly numeric?: boolean
  /** Render as a --brand link (url / email). */
  readonly link?: boolean
  /** Boolean convenience flag (kind === 'boolean'). */
  readonly checked?: boolean | null
  /** Draw as muted placeholder text (empty cells, "no match", "—"). */
  readonly muted?: boolean
  /** StatusCell state (kind === 'status'). */
  readonly status?: CellStatus
  /** Full enrichment provenance (kind === 'status'), for the click → provenance popover. */
  readonly enrichment?: EnrichmentCellMeta
  /** Full AI provenance (kind === 'status', Phase 3), for the click → AI provenance popover. */
  readonly ai?: AiCellMeta
  /** Full agent provenance (kind === 'status', Phase 3 rest), for the click → agent popover. */
  readonly agent?: AgentCellMeta
  /** Full HTTP provenance (kind === 'status', Phase 3 rest), for the click → HTTP popover. */
  readonly http?: HttpCellMeta
  /** Formula error message (kind === 'formula'), shown as a warn tint + tooltip. */
  readonly formulaError?: string
  /** In-flight editor buffer. `undefined` ⇒ the cell was opened but not changed. */
  readonly draft?: string
}

/** A fully-typed Cascade custom cell. */
export type CascadeCell = CustomCell<CascadeCellData>

const KINDS: ReadonlySet<string> = new Set<CascadeKind>([
  'text',
  'longText',
  'number',
  'currency',
  'boolean',
  'singleSelect',
  'multiSelect',
  'date',
  'url',
  'email',
  'phone',
  'status',
])

/** Type guard: is this custom cell one of ours (and, optionally, of a given kind)? */
export function isCascade(cell: CustomCell, kind?: CascadeKind): cell is CascadeCell {
  const data = cell.data as Partial<CascadeCellData> | undefined
  if (!data || typeof data.kind !== 'string' || !KINDS.has(data.kind)) return false
  return kind === undefined || data.kind === kind
}
