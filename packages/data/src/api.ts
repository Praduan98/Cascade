// The CascadeApi contract — a REST-shaped, fully-async interface. MockApi
// implements it today; a real HttpApi can implement it 1:1 later with no UI
// rework. Everything is workspace-scoped; there is no unscoped read path.

import type {
  AgentCellMeta,
  AgentCellResult,
  AgentColumnConfig,
  AiCellMeta,
  AiCellResult,
  AiColumnConfig,
  AiModel,
  AiModelInfo,
  AiOperation,
  AiOutputField,
  AuditEntry,
  Automation,
  AutomationAction,
  AutomationRun,
  AutomationTrigger,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  ColumnState,
  CreditLedgerEntry,
  CreditPurchase,
  CrmConnection,
  CrmProvider,
  CrmSyncDirection,
  CrmSyncRun,
  EnrichmentCellMeta,
  EnrichmentCellResult,
  EnrichmentColumnConfig,
  EnrichmentRun,
  EnrichmentStep,
  FormulaColumnConfig,
  HttpCellMeta,
  HttpCellResult,
  HttpColumnConfig,
  HttpHeader,
  HttpMethod,
  HttpSecret,
  InboundWebhook,
  IntegrationEvent,
  Invite,
  Invoice,
  Member,
  OutboundCondition,
  OutboundWebhook,
  Plan,
  PlatformAuditEntry,
  PlatformRole,
  PlatformUser,
  Provider,
  ProviderCredential,
  RowEvent,
  Role,
  RowWithCells,
  RunScope,
  ScheduleConfig,
  SlackConnection,
  Subscription,
  SubscriptionStatus,
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
  signUp(input: { email: string; password?: string; name?: string; workspaceName?: string; planId?: string }): Promise<Session>
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
// Web-research agent columns (Phase 3, US-3.3/3.4) — mirrors AiApi; adds source
// citations. Reuses the same model catalog, run/estimate/budget machinery.
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'cell'; runId: string; tableId: string; recordId: string; columnId: string; meta: AgentCellMeta; value?: CellValue }
  | { type: 'run'; run: EnrichmentRun }
  | { type: 'budget'; workspaceId: string; balance: number; paused: boolean }

export interface UpsertAgentConfigInput {
  columnId: string
  model: AiModel
  objective: string
  outputSchema?: AiOutputField[]
  outputMapping?: Record<string, string>
  maxSteps?: number
  maxPages?: number
  cacheTtlDays?: number
  autoRun?: boolean
  forceFreshDefault?: boolean
}

export interface AgentConfigsApi {
  get(columnId: string): Promise<AgentColumnConfig | null>
  list(tableId: string): Promise<AgentColumnConfig[]>
  upsert(input: UpsertAgentConfigInput): Promise<AgentColumnConfig>
  remove(columnId: string): Promise<void>
}

export interface AgentApi {
  models: AiModelsApi
  configs: AgentConfigsApi
  runs: RunsApi
  estimate(tableId: string, scope: RunScope, opts?: { forceFresh?: boolean }): Promise<EstimateResult>
  run(tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle>
  results(recordId: string, columnId: string): Promise<AgentCellResult[]>
  cacheStats(workspaceId: string): Promise<CacheStats>
  subscribe(target: { runId?: string; tableId?: string }, cb: (e: AgentEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// HTTP columns (Phase 3, US-3.5) — templated request per row; JSON-path mapping.
// Secrets are write-only; the client only ever sees a masked hint (FR-3.5).
// ---------------------------------------------------------------------------

export type HttpEvent =
  | { type: 'cell'; runId: string; tableId: string; recordId: string; columnId: string; meta: HttpCellMeta; value?: CellValue }
  | { type: 'run'; run: EnrichmentRun }
  | { type: 'budget'; workspaceId: string; balance: number; paused: boolean }

export interface UpsertHttpConfigInput {
  columnId: string
  method: HttpMethod
  urlTemplate: string
  headers?: HttpHeader[]
  bodyTemplate?: string
  responsePath: string
  responseMapping?: Record<string, string>
  outputMapping?: Record<string, string>
  cacheTtlDays?: number
  autoRun?: boolean
  forceFreshDefault?: boolean
}

export interface HttpSecretsApi {
  /** Masked list — the token is never returned (FR-3.5). */
  list(workspaceId: string): Promise<HttpSecret[]>
  /** Create a secret; the plaintext is accepted here but never echoed back. */
  create(workspaceId: string, input: { name: string; token: string }): Promise<HttpSecret>
  remove(workspaceId: string, secretId: string): Promise<void>
}

export interface HttpConfigsApi {
  get(columnId: string): Promise<HttpColumnConfig | null>
  list(tableId: string): Promise<HttpColumnConfig[]>
  upsert(input: UpsertHttpConfigInput): Promise<HttpColumnConfig>
  remove(columnId: string): Promise<void>
}

export interface HttpApi {
  secrets: HttpSecretsApi
  configs: HttpConfigsApi
  runs: RunsApi
  estimate(tableId: string, scope: RunScope, opts?: { forceFresh?: boolean }): Promise<EstimateResult>
  run(tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle>
  results(recordId: string, columnId: string): Promise<HttpCellResult[]>
  cacheStats(workspaceId: string): Promise<CacheStats>
  subscribe(target: { runId?: string; tableId?: string }, cb: (e: HttpEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// Formula columns (Phase 3, US-3.6) — synchronous computed values, no credits.
// ---------------------------------------------------------------------------

export interface UpsertFormulaConfigInput {
  columnId: string
  expression: string
}

export interface FormulaApi {
  get(columnId: string): Promise<FormulaColumnConfig | null>
  list(tableId: string): Promise<FormulaColumnConfig[]>
  upsert(input: UpsertFormulaConfigInput): Promise<FormulaColumnConfig>
  remove(columnId: string): Promise<void>
  /** Validate an expression without saving; returns an error string or null. */
  validate(expression: string): Promise<{ error: string | null }>
  /** Recompute every formula cell in a table (e.g. after a bulk import). */
  recomputeTable(tableId: string): Promise<{ computed: number; errors: number }>
}

// ---------------------------------------------------------------------------
// Automation layer (Phase 3, US-3.7–3.10) — schedules, row-event triggers,
// inbound + outbound webhooks. Admin-gated (canManageAutomations).
// ---------------------------------------------------------------------------

export interface UpsertAutomationInput {
  id?: string
  tableId: string
  name: string
  trigger: AutomationTrigger
  action: AutomationAction
  targetColumnId?: string
  forceFresh?: boolean
  schedule?: ScheduleConfig
  rowEvent?: { event: RowEvent; watchColumnId?: string }
  isEnabled?: boolean
}

export interface AutomationsApi {
  list(workspaceId: string): Promise<Automation[]>
  upsert(workspaceId: string, input: UpsertAutomationInput): Promise<Automation>
  setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<Automation>
  remove(workspaceId: string, id: string): Promise<void>
  /** Fire an automation now (US-3.7 "Run now"); returns the run record. */
  runNow(workspaceId: string, id: string): Promise<AutomationRun>
  runs(workspaceId: string, opts?: { automationId?: string; limit?: number }): Promise<AutomationRun[]>
}

export interface UpsertInboundWebhookInput {
  id?: string
  tableId: string
  name: string
  mapping: Record<string, string>
  isEnabled?: boolean
}

export interface InboundWebhookCreated {
  webhook: InboundWebhook
  /** The full URL + secret, shown ONCE at creation (masked thereafter). */
  url: string
  secret: string
}

export interface UpsertOutboundWebhookInput {
  id?: string
  tableId: string
  name: string
  url: string
  event: RowEvent
  condition?: OutboundCondition
  fieldColumnIds?: string[]
  isEnabled?: boolean
}

export interface WebhooksApi {
  listInbound(workspaceId: string): Promise<InboundWebhook[]>
  createInbound(workspaceId: string, input: UpsertInboundWebhookInput): Promise<InboundWebhookCreated>
  setInboundEnabled(workspaceId: string, id: string, enabled: boolean): Promise<InboundWebhook>
  removeInbound(workspaceId: string, id: string): Promise<void>
  /** Simulate an external POST hitting the endpoint (US-3.9 demo). */
  simulateInbound(slug: string, secret: string, payload: Record<string, unknown>): Promise<{ ok: boolean; recordId?: string; reason?: string }>
  listOutbound(workspaceId: string): Promise<OutboundWebhook[]>
  createOutbound(workspaceId: string, input: UpsertOutboundWebhookInput): Promise<OutboundWebhook>
  setOutboundEnabled(workspaceId: string, id: string, enabled: boolean): Promise<OutboundWebhook>
  removeOutbound(workspaceId: string, id: string): Promise<void>
}

export interface AutomationApi {
  automations: AutomationsApi
  webhooks: WebhooksApi
}

// ---------------------------------------------------------------------------
// Integration layer (Phase 3, US-3.12–3.15) — CRM push/pull, Slack, unified
// event history. Tokens are write-only (FR-3.5). Admin-gated.
// ---------------------------------------------------------------------------

export interface ConnectCrmInput {
  provider: CrmProvider
  token: string
  accountLabel: string
  tableId: string
  fieldMapping?: Record<string, string>
  dedupeColumnId?: string
}

export interface CrmApi {
  list(workspaceId: string): Promise<CrmConnection[]>
  connect(workspaceId: string, input: ConnectCrmInput): Promise<CrmConnection>
  updateMapping(workspaceId: string, id: string, patch: { fieldMapping?: Record<string, string>; dedupeColumnId?: string }): Promise<CrmConnection>
  disconnect(workspaceId: string, id: string): Promise<void>
  /** Push table rows to the CRM or pull CRM records in (US-3.12/3.13). */
  sync(workspaceId: string, id: string, direction: CrmSyncDirection): Promise<CrmSyncRun>
  syncRuns(workspaceId: string, opts?: { connectionId?: string; limit?: number }): Promise<CrmSyncRun[]>
}

export interface ConnectSlackInput {
  token: string
  teamName: string
  defaultChannel: string
}

export interface SlackApi {
  get(workspaceId: string): Promise<SlackConnection | null>
  connect(workspaceId: string, input: ConnectSlackInput): Promise<SlackConnection>
  disconnect(workspaceId: string): Promise<void>
  /** Send a test/notification message (US-3.14). */
  notify(workspaceId: string, input: { channel?: string; text: string }): Promise<{ ok: boolean }>
}

export interface IntegrationApi {
  crm: CrmApi
  slack: SlackApi
  /** The unified activity feed across automations/webhooks/CRM/Slack (US-3.15). */
  events(workspaceId: string, opts?: { source?: string; limit?: number; offset?: number }): Promise<IntegrationEvent[]>
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
// Billing (Phase 4) — plans, subscription, invoices, credit packs. Owner-gated;
// billing consumption derives solely from the Phase 2 ledger (FR-4.1).
// ---------------------------------------------------------------------------

/** Live seat usage for a workspace against its plan (US-4.14). */
export interface SeatUsage {
  used: number
  limit: number
}

/** Workspace billing summary — plan, balance, this-period usage, renewal. */
export interface BillingSummary {
  subscription: Subscription | null
  plan: Plan | null
  balance: number
  includedCredits: number
  /** Credits consumed this billing period (from the ledger). */
  usedThisPeriod: number
  /** Overage credits beyond the plan allotment this period. */
  overageCredits: number
  /** Expected charge at renewal (base + overage), USD. Owner-visible. */
  nextChargeUsd: number
  renewsAt: string | null
  cancelAtPeriodEnd: boolean
  seats: SeatUsage
}

export interface BillingApi {
  plans: {
    list(): Promise<Plan[]>
  }
  summary(workspaceId: string): Promise<BillingSummary>
  /** Upgrade/downgrade/cancel (US-4.4). `cancel` toggles cancelAtPeriodEnd. */
  changePlan(workspaceId: string, planId: string): Promise<Subscription>
  setCancel(workspaceId: string, cancelAtPeriodEnd: boolean): Promise<Subscription>
  /** Buy a credit pack — grants credits to the ledger immediately (US-4.2). */
  purchaseCredits(workspaceId: string, input: { credits: number; amountUsd: number }): Promise<CreditPurchase>
  purchases(workspaceId: string): Promise<CreditPurchase[]>
  invoices(workspaceId: string): Promise<Invoice[]>
  seatUsage(workspaceId: string): Promise<SeatUsage>
}

// ---------------------------------------------------------------------------
// Platform superadmin (Phase 4) — a SEPARATE identity + session, never a
// workspace role (FR-4.2). Cross-tenant; the one place unscoped reads are OK.
// ---------------------------------------------------------------------------

export interface PlatformSession {
  platformUser: PlatformUser
  token: string
  expiresAt: string
}

/** A cross-workspace row for the superadmin workspaces table. */
export interface PlatformWorkspaceSummary {
  workspace: Workspace
  ownerName: string
  ownerEmail: string
  plan: Plan | null
  status: SubscriptionStatus
  balance: number
  seats: number
  /** Credits consumed all-time (from the ledger). */
  creditsConsumed: number
  /** Provider/LLM cost (COGS) all-time, USD. */
  cogsUsd: number
  /** Monthly recurring revenue contributed, USD. */
  mrrUsd: number
  suspended: boolean
}

/** Platform-wide business metrics (US-4.7). */
export interface PlatformAnalytics {
  mrrUsd: number
  arrUsd: number
  activeWorkspaces: number
  suspendedWorkspaces: number
  paidWorkspaces: number
  freeWorkspaces: number
  /** trial/free → paid conversion, 0..1. */
  conversion: number
  /** COGS across all workspaces this period, USD. */
  cogsUsd: number
  /** Gross margin = revenue − COGS, USD. */
  grossMarginUsd: number
  marginPct: number
  /** MRR grouped by plan for the mix chart. */
  mrrByPlan: { planId: string; planName: string; mrrUsd: number; workspaces: number }[]
  /** Credit consumption trend, most-recent-last. */
  consumptionTrend: { label: string; credits: number }[]
}

export interface PlatformApi {
  auth: {
    signIn(email: string, password?: string): Promise<PlatformSession>
    currentSession(): Promise<PlatformSession | null>
    signOut(): Promise<void>
  }
  workspaces: {
    list(): Promise<PlatformWorkspaceSummary[]>
    get(workspaceId: string): Promise<PlatformWorkspaceSummary>
    /** A workspace's active members (cross-tenant; superadmin, US-4.5). */
    members(workspaceId: string): Promise<Member[]>
    setSuspended(workspaceId: string, suspended: boolean, reason: string): Promise<Workspace>
    /** Deactivate a member of a workspace (US-4.5, audited). */
    deactivateUser(workspaceId: string, userId: string, reason: string): Promise<void>
    /** Comp complimentary credits — grants a positive-delta ledger row (US-4.6). */
    compCredits(workspaceId: string, credits: number, reason: string): Promise<void>
    /** Override a workspace's plan (US-4.6). */
    overridePlan(workspaceId: string, planId: string, reason: string): Promise<Subscription>
  }
  invoices: {
    /** A workspace's invoices (cross-tenant; superadmin, for the refund flow). */
    list(workspaceId: string): Promise<Invoice[]>
    /** Issue a refund against an invoice (US-4.6). */
    refund(invoiceId: string, reason: string): Promise<Invoice>
  }
  analytics(opts?: { since?: string }): Promise<PlatformAnalytics>
  audit(opts?: { limit?: number; offset?: number }): Promise<PlatformAuditEntry[]>
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
  agent: AgentApi
  http: HttpApi
  formula: FormulaApi
  automation: AutomationApi
  integration: IntegrationApi
  credits: CreditsApi
  billing: BillingApi
  platform: PlatformApi
}

// Re-export the cell types consumers of the raw store may want.
export type { Cell }
