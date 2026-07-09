// @cascade/core — domain model.
// Framework-agnostic. No React, no DOM assumptions beyond `crypto` (see ids.ts).
//
// The shapes here mirror the Phase-1 FSD data model (workspace / user /
// membership / table / column / record / cell / view / audit_log) and are the
// single source of truth every other package builds on.

import type { FilterGroup } from './filters'
import type { SortSpec } from './sort'

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

// ---------------------------------------------------------------------------
// Column types — the 11 supported types (single source of truth for the union)
// ---------------------------------------------------------------------------

export type ColumnType =
  | 'text'
  | 'longText'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'singleSelect'
  | 'multiSelect'
  | 'date'
  | 'url'
  | 'email'
  | 'phone'

// ---------------------------------------------------------------------------
// Select options
// ---------------------------------------------------------------------------

/** A choice in a single/multi-select column. `id` is stable; cells store the id. */
export interface SelectOption {
  id: string
  label: string
  /** Hex colour (e.g. "#2fe6c8"). Never --gold; gold is reserved for money. */
  color: string
}

// ---------------------------------------------------------------------------
// Per-type column config — a discriminated union keyed on `type`
// ---------------------------------------------------------------------------

export interface TextConfig {
  type: 'text'
}
export interface LongTextConfig {
  type: 'longText'
}
export interface NumberConfig {
  type: 'number'
  /** Fixed decimal places to display. 0 = natural (no forced decimals). */
  precision: number
}
export interface CurrencyConfig {
  type: 'currency'
  /** ISO 4217 code, e.g. "USD". */
  currencyCode: string
  precision: number
}
export interface BooleanConfig {
  type: 'boolean'
}
export interface SingleSelectConfig {
  type: 'singleSelect'
  options: SelectOption[]
}
export interface MultiSelectConfig {
  type: 'multiSelect'
  options: SelectOption[]
}
export interface DateConfig {
  type: 'date'
  /** Display format token string, e.g. "YYYY-MM-DD", "MMM D, YYYY". */
  format: string
}
export interface UrlConfig {
  type: 'url'
}
export interface EmailConfig {
  type: 'email'
}
export interface PhoneConfig {
  type: 'phone'
}

export type ColumnConfig =
  | TextConfig
  | LongTextConfig
  | NumberConfig
  | CurrencyConfig
  | BooleanConfig
  | SingleSelectConfig
  | MultiSelectConfig
  | DateConfig
  | UrlConfig
  | EmailConfig
  | PhoneConfig

/** Maps a column type to its concrete config shape (for strongly-typed access). */
export interface ColumnConfigByType {
  text: TextConfig
  longText: LongTextConfig
  number: NumberConfig
  currency: CurrencyConfig
  boolean: BooleanConfig
  singleSelect: SingleSelectConfig
  multiSelect: MultiSelectConfig
  date: DateConfig
  url: UrlConfig
  email: EmailConfig
  phone: PhoneConfig
}

// ---------------------------------------------------------------------------
// Cell values — a typed union
// ---------------------------------------------------------------------------

/**
 * The stored value of a cell.
 * - text / longText / url / email / phone / date → string | null (date is ISO)
 * - number / currency                            → number | null
 * - boolean                                      → boolean | null
 * - singleSelect                                 → string (option id) | null
 * - multiSelect                                  → string[] (option ids)
 * `null` (and `[]` for multiSelect) means "empty".
 */
export type CellValue = string | number | boolean | string[] | null

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string
  name: string
  ownerUserId: string
  createdAt: string
}

export interface User {
  id: string
  email: string
  name: string
  emailVerified: boolean
  createdAt: string
}

export type MemberStatus = 'active' | 'suspended'

export interface Member {
  id: string
  workspaceId: string
  userId: string
  email: string
  name: string
  role: Role
  status: MemberStatus
  invitedBy: string | null
  createdAt: string
}

export type InviteStatus = 'pending' | 'revoked' | 'accepted'

export interface Invite {
  id: string
  workspaceId: string
  email: string
  role: Role
  invitedBy: string
  status: InviteStatus
  createdAt: string
}

export interface TableMeta {
  id: string
  workspaceId: string
  name: string
  createdBy: string
  createdAt: string
}

export interface Column {
  id: string
  tableId: string
  name: string
  type: ColumnType
  config: ColumnConfig
  position: number
  isFrozen: boolean
  width: number
}

export interface RecordRow {
  id: string
  tableId: string
  position: number
  createdAt: string
  updatedAt: string
}

/**
 * Reserved per-cell metadata. Empty ({}) in Phase 1; Phase 2 attaches
 * enrichment provenance/status (source, status, cost, fetchedAt) here with no
 * schema migration. See FSD FR-1.2.
 */
export type CellMeta = Record<string, unknown>

export interface Cell {
  recordId: string
  columnId: string
  value: CellValue
  meta: CellMeta
}

/** A record together with its cells, keyed by columnId. Returned by records.list. */
export interface RowWithCells {
  row: RecordRow
  cells: Record<string, Cell>
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Per-column presentation state within a view. */
export interface ColumnState {
  columnId: string
  visible: boolean
  position: number
  width?: number
}

export interface View {
  id: string
  tableId: string
  name: string
  filters: FilterGroup
  sorts: SortSpec[]
  columnState: ColumnState[]
  isDefault: boolean
}

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'table.create'
  | 'table.rename'
  | 'table.duplicate'
  | 'table.delete'
  | 'column.add'
  | 'column.update'
  | 'column.retype'
  | 'column.reorder'
  | 'column.remove'
  | 'record.add'
  | 'record.bulkDelete'
  | 'record.reorder'
  | 'csv.import'
  | 'member.invite'
  | 'member.updateRole'
  | 'member.remove'
  | 'invite.revoke'
  | 'view.create'
  | 'view.update'
  | 'view.remove'

export type AuditTargetType =
  | 'table'
  | 'column'
  | 'record'
  | 'member'
  | 'invite'
  | 'view'
  | 'workspace'

export interface AuditEntry {
  id: string
  workspaceId: string
  actorUserId: string
  actorName: string
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  detail: Record<string, unknown>
  createdAt: string
}
