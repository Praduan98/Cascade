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
  // Phase 3 rest — web-research agent, HTTP call, and computed formula columns.
  | 'agent'
  | 'http'
  | 'formula'

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
export interface AgentFieldConfig {
  type: 'agent'
}
export interface HttpFieldConfig {
  type: 'http'
}
export interface FormulaFieldConfig {
  type: 'formula'
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
  | AgentFieldConfig
  | HttpFieldConfig
  | FormulaFieldConfig

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
  agent: AgentFieldConfig
  http: HttpFieldConfig
  formula: FormulaFieldConfig
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

/** A workspace's operational status (Phase 4 — superadmin can suspend). */
export type WorkspaceStatus = 'active' | 'suspended'

export interface Workspace {
  id: string
  name: string
  ownerUserId: string
  createdAt: string
  /** Phase 4 — 'active' by default; superadmin can suspend (US-4.5). */
  status?: WorkspaceStatus
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
  /** Phase 3 rest — web-research agent provenance (with source citations). */
  agent?: AgentCellMeta
  /** Phase 3 rest — HTTP-call provenance (with status code). */
  http?: HttpCellMeta
  /** Phase 3 rest — computed-formula status (synchronous; error carrier). */
  formula?: FormulaCellMeta
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

/** Typed reader over the `cell.meta.agent` slot (Phase 3 rest). */
export function readAgent(meta: CellMeta | undefined | null): AgentCellMeta | undefined {
  const a = meta?.[AGENT_META_KEY]
  return a && typeof a === 'object' ? (a as AgentCellMeta) : undefined
}

/** Typed reader over the `cell.meta.http` slot (Phase 3 rest). */
export function readHttp(meta: CellMeta | undefined | null): HttpCellMeta | undefined {
  const h = meta?.[HTTP_META_KEY]
  return h && typeof h === 'object' ? (h as HttpCellMeta) : undefined
}

/** Typed reader over the `cell.meta.formula` slot (Phase 3 rest). */
export function readFormula(meta: CellMeta | undefined | null): FormulaCellMeta | undefined {
  const f = meta?.[FORMULA_META_KEY]
  return f && typeof f === 'object' ? (f as FormulaCellMeta) : undefined
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
  | 'plan.change'
  | 'credit.purchase'
  | 'subscription.cancel'
  | 'column.agentConfig'
  | 'agent.run'
  | 'column.httpConfig'
  | 'http.run'
  | 'column.formulaConfig'
  | 'automation.create'
  | 'automation.update'
  | 'automation.remove'
  | 'automation.run'
  | 'webhook.inbound.create'
  | 'webhook.inbound.remove'
  | 'webhook.inbound.receive'
  | 'webhook.outbound.create'
  | 'webhook.outbound.remove'
  | 'webhook.outbound.deliver'
  | 'integration.connect'
  | 'integration.disconnect'
  | 'crm.sync'
  | 'slack.notify'
  | 'template.instantiate'
  | 'sequencer.connect'
  | 'sequencer.disconnect'
  | 'sequencer.push'
  | 'onboarding.complete'
  | 'onboarding.skip'

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
  | 'subscription'
  | 'creditPurchase'
  | 'plan'
  | 'agentColumn'
  | 'httpColumn'
  | 'formulaColumn'
  | 'automation'
  | 'webhook'
  | 'integration'
  | 'template'
  | 'sequencer'
  | 'onboarding'

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

// ---------------------------------------------------------------------------
// Web-research agent columns (Phase 3, US-3.3 / US-3.4). A multi-step agent
// that "browses" (mock) up to maxPages, extracts a structured answer, and cites
// its sources. Reuses the AI model catalog + the shared operation pipeline; the
// only new surface is source citations + step/page caps.
// ---------------------------------------------------------------------------

export type AgentOperation = 'research'

/** A cited source the agent "visited" to produce its answer (US-3.4 provenance). */
export interface AgentSource {
  url: string
  title: string
  /** The snippet the agent drew the value from. */
  snippet?: string
}

/** Execution config attached to an `agent` column. Keyed by columnId (side-table). */
export interface AgentColumnConfig {
  id: string
  columnId: string
  /** The LLM used for extraction/synthesis (reuses the AI catalog). */
  model: AiModel
  /** The research question; {{Column}} refs substituted per row (FR-3.3). */
  objective: string
  /** [] → single free-text answer in the anchor; else fan-out like AI. */
  outputSchema: AiOutputField[]
  outputMapping: Record<string, string>
  /** Hard cap on reasoning/browse steps (US-3.3). */
  maxSteps: number
  /** Hard cap on pages fetched per run (US-3.3 / cost control). */
  maxPages: number
  cacheTtlDays: number
  autoRun: boolean
  forceFreshDefault: boolean
  credits: number
  providerCostUsd: number
}

export const AGENT_META_KEY = 'agent' as const

/** Per-cell agent provenance/status stamped onto `cell.meta.agent`. Persisted. */
export interface AgentCellMeta {
  status: EnrichmentCellStatus
  modelKey: string | null
  runId: string | null
  fieldName?: string | null
  /** Steps taken / pages fetched, for the provenance card. */
  steps?: number
  pages?: number
  /** Number of sources cited (full list lives on AgentCellResult). */
  sourceCount?: number
  confidence?: number | null
  credits: number
  fromCache: boolean
  reason?: string
  fetchedAt: string | null
  valueSource: ValueSource
}

/** Per-cell agent result provenance (mirrors AiCellResult + citations). */
export interface AgentCellResult {
  id: string
  recordId: string
  columnId: string
  runId: string
  modelKey: string | null
  operation: AgentOperation | null
  fieldName?: string | null
  status: EnrichmentCellStatus
  valueJson: CellValue
  /** The objective after {{ref}} substitution (US-3.15 explainability). */
  objectiveResolved?: string
  /** The cited sources (US-3.4). */
  sources: AgentSource[]
  steps: number
  pages: number
  confidence: number | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  reason?: string
  fetchedAt: string
}

/** TTL cache entry for agent runs. */
export interface AgentCache {
  id: string
  cacheKey: string
  modelKey: string
  /** `{ text, structured, sources, steps, pages, confidence }`. */
  resultJson: unknown
  cost: number
  fetchedAt: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// HTTP columns (Phase 3, US-3.5). Call an external API per row with a
// templated URL / headers / body; map a JSON-path out of the response into the
// cell (and optional fan-out columns). Secrets are referenced by name and are
// NEVER returned to the client (FR-3.5) — only a masked hint.
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type HttpOperation = 'request'

/** One request header. `secretRef` (if set) resolves server-side; `value` is masked. */
export interface HttpHeader {
  key: string
  /** Literal value, OR a masked placeholder when `secretRef` is set. */
  value: string
  /** Name of a stored secret; the real value is injected server-side only. */
  secretRef?: string
}

/** A stored secret for HTTP auth. The token is write-only — never returned (FR-3.5). */
export interface HttpSecret {
  id: string
  workspaceId: string
  name: string
  /** Last 4 chars, for display only (e.g. "••••ab12"). */
  maskedHint: string
  createdAt: string
}

/** Execution config attached to an `http` column. Keyed by columnId (side-table). */
export interface HttpColumnConfig {
  id: string
  columnId: string
  method: HttpMethod
  /** {{Column}} refs substituted per row. */
  urlTemplate: string
  headers: HttpHeader[]
  /** Templated request body (for non-GET). */
  bodyTemplate: string
  /** Anchor output: a JSON path into the response (e.g. `data.name`, `$`). */
  responsePath: string
  /** field label → JSON path, fanned out to columns via outputMapping. */
  responseMapping: Record<string, string>
  outputMapping: Record<string, string>
  cacheTtlDays: number
  autoRun: boolean
  forceFreshDefault: boolean
  credits: number
  providerCostUsd: number
}

export const HTTP_META_KEY = 'http' as const

/** Per-cell HTTP provenance/status stamped onto `cell.meta.http`. Persisted. */
export interface HttpCellMeta {
  status: EnrichmentCellStatus
  runId: string | null
  fieldName?: string | null
  method?: HttpMethod
  /** The HTTP status code of the (mock) response. */
  statusCode?: number | null
  credits: number
  fromCache: boolean
  reason?: string
  fetchedAt: string | null
  valueSource: ValueSource
}

/** Per-cell HTTP result provenance. */
export interface HttpCellResult {
  id: string
  recordId: string
  columnId: string
  runId: string
  operation: HttpOperation | null
  fieldName?: string | null
  status: EnrichmentCellStatus
  valueJson: CellValue
  method: HttpMethod
  /** The resolved request URL (US-3.15 explainability; secrets stay masked). */
  requestUrl?: string
  statusCode: number | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  reason?: string
  fetchedAt: string
}

/** TTL cache entry for HTTP responses. */
export interface HttpCache {
  id: string
  cacheKey: string
  resultJson: unknown
  cost: number
  fetchedAt: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Formula columns (Phase 3, US-3.6). A computed column: a safe expression over
// other columns (see core/formula.ts). Synchronous, no credits, recomputes when
// a referenced cell changes. The cell holds the computed value; errors surface
// on cell.meta.formula.
// ---------------------------------------------------------------------------

/** Execution config attached to a `formula` column. Keyed by columnId. */
export interface FormulaColumnConfig {
  id: string
  columnId: string
  /** The expression source (parsed/evaluated by core/formula.ts). */
  expression: string
}

export const FORMULA_META_KEY = 'formula' as const

/** Per-cell formula status — `ok` with a value, or `error` with a message. */
export interface FormulaCellMeta {
  status: 'ok' | 'error'
  error?: string
  computedAt: string
}

// ---------------------------------------------------------------------------
// SaaS billing + platform superadmin (Phase 4) — plans, subscriptions, credit
// purchases, invoices, and a SEPARATE platform-staff identity that is never a
// workspace role (FR-4.2). Billing consumption derives SOLELY from the Phase 2
// credit ledger (FR-4.1) — purchases/comps are positive-delta ledger rows.
// ---------------------------------------------------------------------------

export type PlanTier = 'free' | 'starter' | 'growth' | 'scale'

/** How metered usage beyond included credits is handled. */
export type OveragePolicy = 'block' | 'bill'

/** Feature access gated by plan (data-driven entitlements, FR-4.6). */
export interface PlanEntitlements {
  aiColumns: boolean
  prioritySupport: boolean
  sso: boolean
}

/** A subscription plan. Data-driven so plans change without code (FR-4.6). */
export interface Plan {
  id: string
  tier: PlanTier
  name: string
  /** Monthly price in USD (0 for free). */
  priceUsdMonthly: number
  /** Credits included each billing period. */
  includedCredits: number
  /** Max active members + pending invites (US-4.14). */
  seatLimit: number
  overagePolicy: OveragePolicy
  /** $ per extra credit when overagePolicy === 'bill'. */
  overageUsdPerCredit: number
  entitlements: PlanEntitlements
  /** One-line marketing blurb for the plan card. */
  blurb: string
  /** Feature bullets for the plan card. */
  features: string[]
}

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

export interface Subscription {
  id: string
  workspaceId: string
  planId: string
  /** Mock Stripe subscription id. */
  stripeSubscriptionId: string
  status: SubscriptionStatus
  /** ISO date the current period ends / renews. */
  currentPeriodEnd: string
  /** True once the owner cancels; access continues until currentPeriodEnd (US-4.4). */
  cancelAtPeriodEnd: boolean
  createdAt: string
}

/** A one-off credit-pack purchase (top-up). Grants credits to the ledger (US-4.2). */
export interface CreditPurchase {
  id: string
  workspaceId: string
  credits: number
  amountUsd: number
  /** Mock Stripe payment id. */
  stripePaymentId: string
  createdAt: string
}

export type InvoiceStatus = 'paid' | 'open' | 'void' | 'refunded'

export interface InvoiceLineItem {
  label: string
  amountUsd: number
  /** Credits this line represents, if usage-based. */
  credits?: number
}

export interface Invoice {
  id: string
  workspaceId: string
  /** Mock Stripe invoice id. */
  stripeInvoiceId: string
  periodStart: string
  periodEnd: string
  amountUsd: number
  status: InvoiceStatus
  lines: InvoiceLineItem[]
  createdAt: string
}

// --- Platform superadmin (SDTC staff; separate from workspace users — FR-4.2) ---

/** Platform-staff roles. NEVER a workspace Role; a distinct authority ladder. */
export type PlatformRole = 'support' | 'admin'

export interface PlatformUser {
  id: string
  email: string
  name: string
  platformRole: PlatformRole
  createdAt: string
}

/** Append-only platform audit — global, not workspace-scoped (US-4.8). */
export type PlatformAuditAction =
  | 'workspace.suspend'
  | 'workspace.reactivate'
  | 'user.deactivate'
  | 'credit.comp'
  | 'refund.issue'
  | 'plan.override'

export interface PlatformAuditEntry {
  id: string
  platformUserId: string
  platformUserName: string
  action: PlatformAuditAction
  targetType: 'workspace' | 'user' | 'subscription' | 'invoice'
  targetId: string
  detail: Record<string, unknown>
  createdAt: string
}

// ===========================================================================
// AUTOMATION LAYER (Phase 3, US-3.7–3.10) — schedules, row-event triggers,
// and inbound/outbound webhooks. An automation runs a target column (or a
// whole table) on a trigger. All executions land in the unified integration
// event log (US-3.15) alongside CRM/Slack activity.
// ===========================================================================

/** What fires an automation. */
export type AutomationTrigger = 'schedule' | 'row_event'

/** Which column operation an automation drives on fire. */
export type AutomationAction = 'run_column' | 'run_table'

/** How often a scheduled automation runs (US-3.7). */
export type ScheduleCadence = 'hourly' | 'daily' | 'weekly'

/** Which record change fires a row-event automation (US-3.8). */
export type RowEvent = 'record.created' | 'record.updated'

export interface ScheduleConfig {
  cadence: ScheduleCadence
  /** 0–23, for daily/weekly. */
  hour?: number
  /** 0–6 (Sun–Sat), for weekly. */
  weekday?: number
}

export interface RowEventConfig {
  event: RowEvent
  /** Only fire when this column changes (updated); empty = any. */
  watchColumnId?: string
}

/** A configured automation (US-3.7/3.8). */
export interface Automation {
  id: string
  workspaceId: string
  tableId: string
  name: string
  trigger: AutomationTrigger
  action: AutomationAction
  /** The column the action runs (required for run_column). */
  targetColumnId?: string
  /** Only forceFresh when true; else honor cache. */
  forceFresh: boolean
  schedule?: ScheduleConfig
  rowEvent?: RowEventConfig
  isEnabled: boolean
  createdBy: string
  createdAt: string
  /** ISO — when the scheduler will next fire (schedule triggers only). */
  nextRunAt?: string | null
  lastRunAt?: string | null
  /** Terminal status of the last fire. */
  lastStatus?: AutomationRunStatus | null
}

export type AutomationRunStatus = 'success' | 'partial' | 'failed' | 'skipped'

/** One automation execution (feeds the integration event log). */
export interface AutomationRun {
  id: string
  workspaceId: string
  automationId: string
  trigger: AutomationTrigger
  status: AutomationRunStatus
  /** Records/cells touched. */
  affected: number
  detail: string
  startedAt: string
  finishedAt: string
}

// --- Webhooks (US-3.9 inbound, US-3.10 outbound) ---------------------------

/** An inbound webhook endpoint: external POSTs create/update rows (US-3.9). */
export interface InboundWebhook {
  id: string
  workspaceId: string
  tableId: string
  name: string
  /** Path token in the mock URL: /hooks/in/{slug}. */
  slug: string
  /** Shared secret; requests must present it (masked to the client after create). */
  secretHint: string
  /** Incoming JSON field → destination columnId. */
  mapping: Record<string, string>
  isEnabled: boolean
  createdAt: string
  lastReceivedAt?: string | null
  receivedCount: number
}

/** Fire condition for an outbound webhook (a simple column comparison). */
export interface OutboundCondition {
  columnId: string
  op: 'changed' | 'equals' | 'notEmpty'
  value?: string
}

/** An outbound webhook: on a row event/condition, POST selected fields (US-3.10). */
export interface OutboundWebhook {
  id: string
  workspaceId: string
  tableId: string
  name: string
  url: string
  event: RowEvent
  condition?: OutboundCondition
  /** Columns included in the payload (empty = all). */
  fieldColumnIds: string[]
  isEnabled: boolean
  createdAt: string
  lastDeliveryAt?: string | null
  /** For the delivery log / retry display. */
  lastStatus?: 'delivered' | 'failed' | 'retrying' | null
  deliveredCount: number
  failedCount: number
}

// ===========================================================================
// INTEGRATION LAYER (Phase 3, US-3.12–3.14) — CRM push/pull + Slack. Tokens
// are write-only (never returned; FR-3.5). All activity + webhook + automation
// runs surface in one unified event history (US-3.15).
// ===========================================================================

export type CrmProvider = 'hubspot' | 'salesforce' | 'pipedrive'

/** A connected CRM. `token` is never stored in the client-returned shape. */
export interface CrmConnection {
  id: string
  workspaceId: string
  provider: CrmProvider
  /** Display label (e.g. the connected account/domain). */
  accountLabel: string
  maskedToken: string
  /** The table this connection syncs. */
  tableId: string
  /** CRM object → columnId (both push + pull). */
  fieldMapping: Record<string, string>
  /** Which columnId is the dedupe key (email/domain). */
  dedupeColumnId?: string
  isConnected: boolean
  createdAt: string
  lastSyncAt?: string | null
}

export type CrmSyncDirection = 'push' | 'pull'

export interface CrmSyncRun {
  id: string
  workspaceId: string
  connectionId: string
  provider: CrmProvider
  direction: CrmSyncDirection
  created: number
  updated: number
  skipped: number
  failed: number
  startedAt: string
  finishedAt: string
}

/** A connected Slack workspace for notifications (US-3.14). */
export interface SlackConnection {
  id: string
  workspaceId: string
  teamName: string
  maskedToken: string
  defaultChannel: string
  isConnected: boolean
  createdAt: string
}

/** Unified activity feed across automations, webhooks, CRM, Slack (US-3.15). */
export type IntegrationEventSource =
  | 'schedule'
  | 'row_event'
  | 'webhook_in'
  | 'webhook_out'
  | 'crm'
  | 'slack'
  | 'sequencer'

export type IntegrationEventStatus = 'success' | 'partial' | 'failed' | 'skipped'

export interface IntegrationEvent {
  id: string
  workspaceId: string
  source: IntegrationEventSource
  status: IntegrationEventStatus
  /** Human-readable summary line. */
  summary: string
  /** Structured detail for the expandable row. */
  detail: Record<string, unknown>
  /** Optional links back to the originating object. */
  tableId?: string
  refId?: string
  createdAt: string
}

// ===========================================================================
// TEMPLATES (Phase 4, US-4.9) — a curated library of pre-built table + column
// recipes. A template is a serialized definition (columns + configured
// enrichment/AI/agent by column NAME) that the instantiation routine expands
// into a real table with configured columns ready to run.
// ===========================================================================

export type TemplateCategory = 'sales' | 'recruiting' | 'research' | 'operations'

export interface TemplateColumn {
  name: string
  type: ColumnType
  /** Optional explicit config; defaults to defaultConfigFor(type). */
  config?: ColumnConfig
  frozen?: boolean
  width?: number
}

/** A waterfall step in a template — provider input/output map to column NAMES. */
export interface TemplateEnrichmentStep {
  /** provider.key (resolved to providerId on instantiate). */
  providerKey: string
  operation: EnrichmentOperation
  /** provider input field → column NAME. */
  inputMapping: Record<string, string>
  /** provider output field → column NAME. */
  outputMapping: Record<string, string>
  acceptanceCondition: AcceptanceCondition
  acceptField?: string
  minConfidence?: number
}

export interface TemplateEnrichment {
  /** The anchor (output) column NAME. */
  columnName: string
  autoRun?: boolean
  steps: TemplateEnrichmentStep[]
}

export interface TemplateAiColumn {
  columnName: string
  model: AiModel
  operation: AiOperation
  promptTemplate: string
  outputSchema?: AiOutputField[]
  /** schema field → destination column NAME. */
  outputMapping?: Record<string, string>
}

export interface TemplateAgentColumn {
  columnName: string
  model: AiModel
  objective: string
  maxSteps?: number
  maxPages?: number
}

export interface TemplateFormulaColumn {
  columnName: string
  expression: string
}

export interface Template {
  id: string
  name: string
  summary: string
  category: TemplateCategory
  /** Two-letter monogram for the card. */
  glyph: string
  /** Hex accent for the card. */
  accent: string
  tags: string[]
  tableName: string
  columns: TemplateColumn[]
  enrichment?: TemplateEnrichment[]
  ai?: TemplateAiColumn[]
  agent?: TemplateAgentColumn[]
  formula?: TemplateFormulaColumn[]
  /** Sample rows keyed by column NAME (so the instantiated table isn't empty). */
  sampleRows?: Record<string, CellValue>[]
  /** Max credits per row when the configured columns run (0 = free). */
  creditsPerRow: number
}

// ===========================================================================
// OUTBOUND SEQUENCERS (Phase 4, US-4.10) — push enriched lists to a sequencing
// tool (Instantly / Smartlead / HeyReach). Tokens are write-only (masked hint
// only). Reuses the Phase-3 connector patterns for auth + logging.
// ===========================================================================

export type SequencerProvider = 'instantly' | 'smartlead' | 'heyreach'

export interface SequencerConnection {
  id: string
  workspaceId: string
  provider: SequencerProvider
  accountLabel: string
  maskedToken: string
  isConnected: boolean
  createdAt: string
  lastPushAt?: string | null
}

/** A campaign/list on the connected sequencer (mock catalog per connection). */
export interface SequencerCampaign {
  id: string
  name: string
  /** Existing contacts, for a believable "already in campaign" skip count. */
  contactCount: number
}

/** How rows are filtered before a push (US-4.10 optional condition). */
export interface SequencerPushFilter {
  columnId: string
  op: 'equals' | 'notEmpty'
  value?: string
}

export interface SequencerPushRun {
  id: string
  workspaceId: string
  connectionId: string
  provider: SequencerProvider
  campaignName: string
  /** Rows selected for the push (after the filter). */
  pushed: number
  created: number
  failed: number
  /** Rows dropped by the filter or already in the campaign. */
  skipped: number
  filterApplied: boolean
  startedAt: string
  finishedAt: string
}

// ===========================================================================
// ONBOARDING (Phase 4, US-4.12) — a guided first-run to a working table. State
// is per workspace; skippable + revisitable.
// ===========================================================================

export type OnboardingStatus = 'pending' | 'completed' | 'skipped'

export interface OnboardingState {
  workspaceId: string
  status: OnboardingStatus
  /** The table produced by onboarding (for the "see results" step). */
  createdTableId?: string | null
  updatedAt: string
}
