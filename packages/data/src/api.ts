// The CascadeApi contract — a REST-shaped, fully-async interface. MockApi
// implements it today; a real HttpApi can implement it 1:1 later with no UI
// rework. Everything is workspace-scoped; there is no unscoped read path.

import type {
  AiCellMeta,
  AiCellResult,
  AiColumnConfig,
  AiModel,
  AiModelInfo,
  AiOperation,
  AiOutputField,
  AuditEntry,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  ColumnState,
  CreditLedgerEntry,
  EnrichmentCellMeta,
  EnrichmentCellResult,
  EnrichmentColumnConfig,
  EnrichmentRun,
  EnrichmentStep,
  Invite,
  Member,
  Provider,
  ProviderCredential,
  Role,
  RowWithCells,
  RunScope,
  TableMeta,
  User,
  View,
  Workspace,
} from '@cascade/core'
import type { FilterGroup, SortSpec } from '@cascade/core'

// ---------------------------------------------------------------------------
// Auth / session
// ---------------------------------------------------------------------------

export interface Session {
  user: User
  /** The workspace the session is currently acting within. */
  workspaceId: string
  role: Role
  token: string
  expiresAt: string
}

export interface AuthApi {
  signIn(email: string, password?: string): Promise<Session>
  signUp(input: { email: string; password?: string; name?: string; workspaceName?: string }): Promise<Session>
  magicLink(email: string): Promise<{ sent: true }>
  currentSession(): Promise<Session | null>
  /** Demo affordance: switch the acting user to exercise different roles. */
  switchUser(userId: string): Promise<Session>
  signOut(): Promise<void>
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface WorkspacesApi {
  list(): Promise<Workspace[]>
  get(workspaceId: string): Promise<Workspace>
  create(input: { name: string }): Promise<Workspace>
}

// ---------------------------------------------------------------------------
// Members / invites
// ---------------------------------------------------------------------------

export interface MembersApi {
  list(workspaceId: string): Promise<Member[]>
  invite(workspaceId: string, input: { email: string; role: Role }): Promise<Invite>
  updateRole(workspaceId: string, memberId: string, role: Role): Promise<Member>
  remove(workspaceId: string, memberId: string): Promise<void>
  listPendingInvites(workspaceId: string): Promise<Invite[]>
  revokeInvite(workspaceId: string, inviteId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface TablesApi {
  list(workspaceId: string): Promise<TableMeta[]>
  get(tableId: string): Promise<TableMeta>
  create(workspaceId: string, input: { name: string }): Promise<TableMeta>
  rename(tableId: string, name: string): Promise<TableMeta>
  duplicate(tableId: string, input?: { name?: string; includeRecords?: boolean }): Promise<TableMeta>
  remove(tableId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface AddColumnInput {
  name: string
  type: ColumnType
  config?: ColumnConfig
  position?: number
  isFrozen?: boolean
  width?: number
}

export interface UpdateColumnInput {
  name?: string
  config?: ColumnConfig
  isFrozen?: boolean
  width?: number
}

export interface ColumnsApi {
  list(tableId: string): Promise<Column[]>
  add(tableId: string, input: AddColumnInput): Promise<Column>
  update(columnId: string, patch: UpdateColumnInput): Promise<Column>
  /** Change a column's type, coercing existing cells. Returns count coerced/lost. */
  retype(columnId: string, toType: ColumnType, config?: ColumnConfig): Promise<{ column: Column; coerced: number; lost: number }>
  reorder(tableId: string, orderedColumnIds: string[]): Promise<Column[]>
  remove(columnId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface ListRecordsOptions {
  viewId?: string
  /** Ad-hoc filter/sort override (used before a view is saved). */
  filters?: FilterGroup
  sorts?: SortSpec[]
  offset?: number
  limit?: number
}

export interface ListRecordsResult {
  rows: RowWithCells[]
  /** Total rows after filtering (before pagination). */
  total: number
}

export interface AddRecordInput {
  position?: number
  /** Initial cell values keyed by columnId. */
  cells?: Record<string, CellValue>
}

export interface RecordsApi {
  list(tableId: string, opts?: ListRecordsOptions): Promise<ListRecordsResult>
  count(tableId: string, viewId?: string): Promise<number>
  add(tableId: string, input?: AddRecordInput): Promise<RowWithCells>
  bulkDelete(tableId: string, recordIds: string[]): Promise<{ deleted: number }>
  reorder(tableId: string, recordId: string, toPosition: number): Promise<void>
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface CellEdit {
  recordId: string
  columnId: string
  value: CellValue
  /** Last-write-wins guard; if it differs from the current record, a conflict is returned. */
  expectedUpdatedAt?: string
}

export interface CellUpdate {
  recordId: string
  columnId: string
  value: CellValue
  updatedAt: string
}

export interface CellConflict {
  recordId: string
  columnId: string
  currentValue: CellValue
  currentUpdatedAt: string
}

export interface PatchCellsResult {
  updated: CellUpdate[]
  conflicts: CellConflict[]
}

export interface CellsApi {
  patch(edits: CellEdit[]): Promise<PatchCellsResult>
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface CreateViewInput {
  name: string
  filters?: FilterGroup
  sorts?: SortSpec[]
  columnState?: ColumnState[]
}

export interface UpdateViewInput {
  name?: string
  filters?: FilterGroup
  sorts?: SortSpec[]
  columnState?: ColumnState[]
}

export interface ViewsApi {
  list(tableId: string): Promise<View[]>
  create(tableId: string, input: CreateViewInput): Promise<View>
  update(viewId: string, patch: UpdateViewInput): Promise<View>
  remove(viewId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditApi {
  list(workspaceId: string, opts?: { offset?: number; limit?: number }): Promise<AuditEntry[]>
}

// ---------------------------------------------------------------------------
// Enrichment (Phase 2)
// ---------------------------------------------------------------------------

/**
 * A live enrichment event. `subscribe` pushes these so the grid animates cell
 * transitions and run-count UI updates without polling. A real HttpApi would
 * deliver the identical union over SSE/WebSocket.
 */
export type EnrichmentEvent =
  | {
      type: 'cell'
      runId: string
      tableId: string
      recordId: string
      columnId: string
      meta: EnrichmentCellMeta
      value?: CellValue
    }
  | { type: 'run'; run: EnrichmentRun }
  | { type: 'budget'; workspaceId: string; balance: number; paused: boolean }

export interface ProvidersApi {
  list(workspaceId: string): Promise<Provider[]>
}

export interface UpsertCredentialInput {
  providerId: string
  /** Plaintext key (BYO). Stored masked; never returned. Omit for platform-managed. */
  apiKey?: string
  useByoKey: boolean
}

export interface CredentialsApi {
  list(workspaceId: string): Promise<ProviderCredential[]>
  upsert(workspaceId: string, input: UpsertCredentialInput): Promise<ProviderCredential>
  remove(workspaceId: string, credentialId: string): Promise<void>
}

export interface UpsertConfigInput {
  columnId: string
  autoRun?: boolean
  forceFreshDefault?: boolean
  steps: EnrichmentStep[]
}

export interface ConfigsApi {
  get(columnId: string): Promise<EnrichmentColumnConfig | null>
  /** All enrichment configs in a table (drives the grid "waterfall" badge). */
  list(tableId: string): Promise<EnrichmentColumnConfig[]>
  upsert(input: UpsertConfigInput): Promise<EnrichmentColumnConfig>
  remove(columnId: string): Promise<void>
}

export interface EstimateResult {
  /** Billable candidate rows. */
  rows: number
  totalTargeted: number
  skippedCached: number
  skippedEmptyInput: number
  skippedAlreadyFilled: number
  maxCredits: number
  /** null for non-admin viewers (US-2.12). */
  maxProviderCostUsd: number | null
  perColumn: Array<{ columnId: string; rows: number; maxCredits: number }>
  blockedByPerRunCap: boolean
  blockedByBudget: boolean
}

export interface RunOptions {
  forceFresh?: boolean
  /** The estimate the user confirmed; the run re-validates against the cap. */
  confirmedMaxCredits?: number
}

export interface RunHandle {
  runId: string
}

export interface RunsApi {
  list(workspaceId: string, opts?: { tableId?: string; limit?: number; offset?: number }): Promise<EnrichmentRun[]>
  get(runId: string): Promise<EnrichmentRun>
}

export interface CacheStats {
  entries: number
  hitSavingsCredits: number
  hitSavingsUsd: number | null
}

export interface EnrichmentApi {
  providers: ProvidersApi
  credentials: CredentialsApi
  configs: ConfigsApi
  runs: RunsApi
  estimate(tableId: string, scope: RunScope, opts?: { forceFresh?: boolean }): Promise<EstimateResult>
  run(tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle>
  /** Per-cell provenance, newest-first. */
  results(recordId: string, columnId: string): Promise<EnrichmentCellResult[]>
  cacheStats(workspaceId: string): Promise<CacheStats>
  /** Live event stream. Synchronous — returns an unsubscribe function. */
  subscribe(target: { runId?: string; tableId?: string }, cb: (e: EnrichmentEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// AI columns (Phase 3) — a parallel namespace that mirrors EnrichmentApi and
// shares the credit machinery. Runs execute on the same pipeline; events carry
// the identical `run`/`budget` shapes so the UI wiring is 1:1 with enrichment.
// ---------------------------------------------------------------------------

export type AiEvent =
  | {
      type: 'cell'
      runId: string
      tableId: string
      recordId: string
      columnId: string
      meta: AiCellMeta
      value?: CellValue
    }
  | { type: 'run'; run: EnrichmentRun }
  | { type: 'budget'; workspaceId: string; balance: number; paused: boolean }

export interface AiModelsApi {
  /** Available models; providerCostUsd is redacted (0) for non-admin. */
  list(workspaceId: string): Promise<AiModelInfo[]>
}

export interface UpsertAiConfigInput {
  columnId: string
  model: AiModel
  operation: AiOperation
  promptTemplate: string
  outputSchema?: AiOutputField[]
  outputMapping?: Record<string, string>
  cacheTtlDays?: number
  autoRun?: boolean
  forceFreshDefault?: boolean
}

export interface AiConfigsApi {
  get(columnId: string): Promise<AiColumnConfig | null>
  /** All AI configs in a table (drives the grid "AI" badge + column id-set). */
  list(tableId: string): Promise<AiColumnConfig[]>
  upsert(input: UpsertAiConfigInput): Promise<AiColumnConfig>
  remove(columnId: string): Promise<void>
}

export interface AiApi {
  models: AiModelsApi
  configs: AiConfigsApi
  runs: RunsApi
  estimate(tableId: string, scope: RunScope, opts?: { forceFresh?: boolean }): Promise<EstimateResult>
  run(tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle>
  /** Per-cell AI provenance, newest-first. */
  results(recordId: string, columnId: string): Promise<AiCellResult[]>
  cacheStats(workspaceId: string): Promise<CacheStats>
  subscribe(target: { runId?: string; tableId?: string }, cb: (e: AiEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// Credits & usage (Phase 2)
// ---------------------------------------------------------------------------

export interface BudgetSettings {
  balance: number
  budgetCap: number
  perRunCap: number
}

export interface BalanceInfo extends BudgetSettings {
  /** True once the workspace budget is exhausted (billable enrichment paused). */
  paused: boolean
}

/** One row of a consumption breakdown (by provider / column / table). */
export interface ConsumptionBucket {
  key: string
  label: string
  credits: number
  /** null for non-admin viewers (US-2.12). */
  providerCostUsd: number | null
}

export interface CreditsApi {
  balance(workspaceId: string): Promise<BalanceInfo>
  budget: {
    get(workspaceId: string): Promise<BudgetSettings>
    set(workspaceId: string, patch: Partial<Pick<BudgetSettings, 'budgetCap' | 'perRunCap'>>): Promise<BudgetSettings>
  }
  ledger(workspaceId: string, opts?: { runId?: string; limit?: number; offset?: number }): Promise<CreditLedgerEntry[]>
  consumptionByProvider(workspaceId: string, opts?: { since?: string }): Promise<ConsumptionBucket[]>
  consumptionByColumn(workspaceId: string, opts?: { since?: string }): Promise<ConsumptionBucket[]>
  consumptionByTable(workspaceId: string, opts?: { since?: string }): Promise<ConsumptionBucket[]>
  /** AI spend grouped by model, from the `ai:<modelKey>:<op>` ledger reasons. */
  consumptionByModel(workspaceId: string, opts?: { since?: string }): Promise<ConsumptionBucket[]>
}

// ---------------------------------------------------------------------------
// The composed contract
// ---------------------------------------------------------------------------

export interface CascadeApi {
  auth: AuthApi
  workspaces: WorkspacesApi
  members: MembersApi
  tables: TablesApi
  columns: ColumnsApi
  records: RecordsApi
  cells: CellsApi
  views: ViewsApi
  audit: AuditApi
  enrichment: EnrichmentApi
  ai: AiApi
  credits: CreditsApi
}

// Re-export the cell types consumers of the raw store may want.
export type { Cell }
