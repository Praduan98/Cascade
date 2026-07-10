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
  // Phase 3 — an AI column stores its primary output as text; execution config
  // lives in a side-table (AiColumnConfig) keyed by the column id.
  | 'ai'

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
/** Inline per-column config for an `ai` column (execution config is separate). */
export interface AiFieldConfig {
  type: 'ai'
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
  | AiFieldConfig

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
  ai: AiFieldConfig
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
 * The six FSD enrichment states every asynchronous cell moves through — the
 * single most important pattern in the product. Mirrored by the grid's
 * `StatusKey` and the design's `--st-*` tokens.
 */
export type EnrichmentCellStatus = 'queued' | 'running' | 'success' | 'empty' | 'failed' | 'cached'

/** Where a written value came from. */
export type ValueSource = 'provider' | 'cache' | 'manual'

/**
 * Enrichment provenance/status stamped onto `cell.meta.enrichment`. Persisted,
 * so per-cell status survives reload (US-2.6 / FR-2.5) even when the in-memory
 * run emitter does not.
 */
export interface EnrichmentCellMeta {
  status: EnrichmentCellStatus
  providerId: string | null
  stepIndex: number | null
  runId: string | null
  confidence?: number | null
  credits: number
  fromCache: boolean
  reason?: string
  fetchedAt: string | null
  valueSource: ValueSource
}

/** The reserved-in-Phase-1 metadata slot; the `enrichment` key is filled here. */
export const ENRICHMENT_META_KEY = 'enrichment' as const

/**
 * Per-cell metadata. Empty ({}) in Phase 1; Phase 2 attaches enrichment
 * provenance/status under `meta.enrichment` with no schema migration (FSD
 * FR-1.2). The open index signature preserves the Phase-1 shape.
 */
export interface CellMeta {
  enrichment?: EnrichmentCellMeta
  /** Phase 3 — per-cell AI provenance/status, a sibling of `enrichment`. */
  ai?: AiCellMeta
  [key: string]: unknown
}

/** Typed reader over the reserved `cell.meta.enrichment` slot. */
export function readEnrichment(meta: CellMeta | undefined | null): EnrichmentCellMeta | undefined {
  const e = meta?.[ENRICHMENT_META_KEY]
  return e && typeof e === 'object' ? (e as EnrichmentCellMeta) : undefined
}

/** Typed reader over the `cell.meta.ai` slot (Phase 3). */
export function readAi(meta: CellMeta | undefined | null): AiCellMeta | undefined {
  const a = meta?.[AI_META_KEY]
  return a && typeof a === 'object' ? (a as AiCellMeta) : undefined
}

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
  | 'column.enrich'
  | 'enrichment.run'
  | 'provider.keyUpdate'
  | 'budget.update'
  | 'column.aiConfig'
  | 'ai.run'

export type AuditTargetType =
  | 'table'
  | 'column'
  | 'record'
  | 'member'
  | 'invite'
  | 'view'
  | 'workspace'
  | 'provider'
  | 'enrichmentColumn'
  | 'enrichmentRun'
  | 'aiColumn'
  | 'aiRun'

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

// ---------------------------------------------------------------------------
// Enrichment engine (Phase 2) — providers, waterfalls, runs, provenance,
// caching, and internal credit metering. These mirror FSD §5 (camelCase) and
// are the single source of truth for @cascade/data and the UI.
// ---------------------------------------------------------------------------

/** The enrichment jobs the launch provider set covers. */
export type ProviderCategory = 'people' | 'company' | 'email_find' | 'email_verify' | 'phone'

/** A provider operation — the unit an adapter exposes and the engine calls. */
export type EnrichmentOperation =
  | 'person_enrich'
  | 'company_enrich'
  | 'find_email'
  | 'verify_email'
  | 'find_phone'

/** Cost of one billable call: internal credits + best-known provider cost. */
export interface ProviderOperationCost {
  credits: number
  providerCostUsd: number
}

export interface Provider {
  id: string
  /** Stable slug, e.g. 'pdl'. */
  key: string
  name: string
  category: ProviderCategory
  /** Requests/second the engine's token bucket never exceeds (FR-2.6). */
  defaultRateLimit: number
  /** Cache freshness default (US-2.9). */
  defaultTtlDays: number
  costConfig: Partial<Record<EnrichmentOperation, ProviderOperationCost>>
  supportsByoKey: boolean
  /** Two-letter monogram for the coloured provider square. */
  glyph: string
  /** Hex colour of the provider square. */
  monoColor: string
}

export type CredentialStatus = 'active' | 'invalid' | 'missing'

/** A workspace's credential for a provider. Plaintext keys never leave the API. */
export interface ProviderCredential {
  id: string
  workspaceId: string
  providerId: string
  isPlatformManaged: boolean
  /** e.g. '••••4f2a' — the only key material ever returned to the client. */
  maskedKey: string
  status: CredentialStatus
  createdAt: string
}

/**
 * When a waterfall step's result is accepted vs. fallen through:
 * - `empty`            — accept if any usable value is returned (default).
 * - `nonEmptyField`    — accept only if a named output field is non-empty.
 * - `minConfidence`    — accept only above a confidence threshold.
 * - `verifyDeliverable`— accept only a Deliverable verify verdict (US-2.14).
 */
export type AcceptanceCondition = 'empty' | 'nonEmptyField' | 'minConfidence' | 'verifyDeliverable'

export interface EnrichmentStep {
  providerId: string
  operation: EnrichmentOperation
  /** provider input field → source columnId. */
  inputMapping: Record<string, string>
  /** provider output field → destination columnId. */
  outputMapping: Record<string, string>
  acceptanceCondition: AcceptanceCondition
  /** For `nonEmptyField`. */
  acceptField?: string
  /** For `minConfidence` (0..1). */
  minConfidence?: number
  /** Denormalized snapshot of provider cost for estimate display. */
  credits: number
  providerCostUsd: number
}

/** The ordered waterfall attached to an anchor (output) column. */
export interface EnrichmentColumnConfig {
  id: string
  /** The anchor column, badged "waterfall" in the grid. */
  columnId: string
  autoRun: boolean
  forceFreshDefault: boolean
  steps: EnrichmentStep[]
}

export type RunScopeMode = 'selected' | 'whole' | 'empty-only'

export interface RunScope {
  mode: RunScopeMode
  /** Required when mode === 'selected'. */
  recordIds?: string[]
  /** Anchor columns to run. */
  columnIds: string[]
}

export type EnrichmentRunStatus = 'queued' | 'running' | 'complete' | 'paused' | 'failed'

export interface EnrichmentRunCounts {
  processed: number
  total: number
  success: number
  empty: number
  failed: number
  cached: number
}

export interface EnrichmentRun {
  id: string
  workspaceId: string
  tableId: string
  triggeredBy: string
  triggeredByName: string
  scope: RunScope
  forceFresh: boolean
  status: EnrichmentRunStatus
  counts: EnrichmentRunCounts
  creditsConsumed: number
  providerCostUsd: number
  startedAt: string
  finishedAt: string | null
}

/** Per-cell provenance (also mirrored onto `cell.meta.enrichment`). */
export interface EnrichmentCellResult {
  id: string
  recordId: string
  /** The anchor column. */
  columnId: string
  runId: string
  providerId: string | null
  stepIndex: number | null
  status: EnrichmentCellStatus
  valueJson: CellValue
  confidence: number | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  reason?: string
  fetchedAt: string
}

export interface EnrichmentCache {
  id: string
  /** `${providerId}|${operation}|${normalizedInput}`. */
  cacheKey: string
  providerId: string
  operation: EnrichmentOperation
  resultJson: unknown
  /** providerCostUsd of the original fetch (measurable cache savings). */
  cost: number
  fetchedAt: string
  expiresAt: string
}

/** Append-only internal metering ledger (customer billing arrives in Phase 4). */
export interface CreditLedgerEntry {
  id: string
  workspaceId: string
  /** Negative = consumption, positive = grant. */
  delta: number
  reason: string
  runId?: string
  balanceAfter: number
  createdAt: string
}

/** A workspace's credit balance and spend caps (US-2.10 / US-2.11). */
export interface WorkspaceCredit {
  workspaceId: string
  balance: number
  /** Per-period workspace budget. */
  budgetCap: number
  /** Maximum credits a single run may consume. */
  perRunCap: number
}

// ---------------------------------------------------------------------------
// AI columns (Phase 3) — a prompt-driven column that references other cells and
// writes an LLM-generated result (US-3.1) with optional structured output
// (US-3.2). AI runs execute on the SAME pipeline as enrichment: the six-state
// status machine, the credit ledger, the TTL cache, and per-cell provenance.
// ---------------------------------------------------------------------------

export type AiProvider = 'anthropic' | 'openai' | 'google'

/** Model identity stored on a config. `model` doubles as the colonless ledger key. */
export interface AiModel {
  provider: AiProvider
  /** Provider model id, e.g. 'claude-haiku-4-5' — also the `ai:<key>:<op>` token. */
  model: string
}

/** Cost + display catalog entry (mirrors Provider cost; the DATA layer owns the list). */
export interface AiModelInfo {
  /** === AiModel.model; the parseable ledger key. */
  key: string
  label: string
  provider: AiProvider
  model: string
  /** Two-letter monogram for the coloured model square. */
  glyph: string
  /** Hex colour of the model square (cobalt family — AI accent). */
  monoColor: string
  /** Internal credits per successful generation. */
  credits: number
  /** Best-known provider cost (admin-only; redacted for members). */
  providerCostUsd: number
  isDefault?: boolean
}

/** The AI task kind — drives believable mock output + the ledger op segment. */
export type AiOperation = 'summarize' | 'classify' | 'extract' | 'generate'

/** One structured-output field (US-3.2); coerced into a destination column by type. */
export interface AiOutputField {
  name: string
  type: ColumnType
  description?: string
}

/** Execution config attached to an `ai` column. Keyed by columnId (side-table). */
export interface AiColumnConfig {
  id: string
  /** The `ai` anchor column; its own cell holds the primary text output. */
  columnId: string
  model: AiModel
  operation: AiOperation
  /** {{Column Name}} references, substituted per row (FR-3.3). */
  promptTemplate: string
  /** [] for a plain single-output column; else fields fan out to columns. */
  outputSchema: AiOutputField[]
  /** schema field name → destination columnId. */
  outputMapping: Record<string, string>
  cacheTtlDays: number
  autoRun: boolean
  forceFreshDefault: boolean
  /** Denormalized cost snapshot (mirrors EnrichmentStep). */
  credits: number
  providerCostUsd: number
}

export const AI_META_KEY = 'ai' as const

/** Per-cell AI provenance/status stamped onto `cell.meta.ai`. Persisted. */
export interface AiCellMeta {
  status: EnrichmentCellStatus
  modelKey: string | null
  operation: AiOperation | null
  runId: string | null
  /** Set on a structured sub-field write; null/absent on the anchor. */
  fieldName?: string | null
  confidence?: number | null
  credits: number
  fromCache: boolean
  reason?: string
  fetchedAt: string | null
  valueSource: ValueSource
}

/** Per-cell AI result provenance (mirrors EnrichmentCellResult). */
export interface AiCellResult {
  id: string
  recordId: string
  /** The anchor `ai` column. */
  columnId: string
  runId: string
  modelKey: string | null
  operation: AiOperation | null
  fieldName?: string | null
  status: EnrichmentCellStatus
  valueJson: CellValue
  /** The prompt after {{ref}} substitution, for explainability (US-3.15). */
  promptResolved?: string
  confidence: number | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  reason?: string
  fetchedAt: string
}

/** TTL cache entry for AI generations (mirrors EnrichmentCache). */
export interface AiCache {
  id: string
  /** `${modelKey}|${operation}|${normalizedResolvedPrompt}`. */
  cacheKey: string
  modelKey: string
  operation: AiOperation
  /** `{ text, structured, confidence }`. */
  resultJson: unknown
  cost: number
  fetchedAt: string
  expiresAt: string
}
