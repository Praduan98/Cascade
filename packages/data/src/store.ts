// In-memory data model + best-effort localStorage persistence. The Store owns
// the arrays and maintains a fast cell index (recordId|columnId → Cell). It is
// framework-agnostic: `localStorage` is used only if present (browser), and
// writes are wrapped so quota errors (e.g. a 100k-row perf dataset) degrade to
// memory-only rather than throwing.

import type {
  AgentCache,
  AgentCellResult,
  AgentColumnConfig,
  AiCache,
  AiCellResult,
  AiColumnConfig,
  AuditEntry,
  Automation,
  AutomationRun,
  Cell,
  Column,
  CreditLedgerEntry,
  CreditPurchase,
  CrmConnection,
  CrmSyncRun,
  EnrichmentCache,
  EnrichmentCellResult,
  EnrichmentColumnConfig,
  EnrichmentRun,
  FormulaColumnConfig,
  HttpCache,
  HttpCellResult,
  HttpColumnConfig,
  HttpSecret,
  InboundWebhook,
  IntegrationEvent,
  Invite,
  Invoice,
  Member,
  OnboardingState,
  OutboundWebhook,
  SequencerConnection,
  SequencerPushRun,
  Plan,
  PlatformAuditEntry,
  PlatformUser,
  Provider,
  ProviderCredential,
  RecordRow,
  SlackConnection,
  Subscription,
  TableMeta,
  User,
  View,
  Workspace,
  WorkspaceCredit,
} from '@cascade/core'

export interface SessionState {
  userId: string
  workspaceId: string
  token: string
  expiresAt: string
}

/** A platform-staff session — global, never workspace-scoped (Phase 4, FR-4.2). */
export interface PlatformSessionState {
  platformUserId: string
  token: string
  expiresAt: string
}

export interface StoreData {
  version: number
  users: User[]
  workspaces: Workspace[]
  members: Member[]
  invites: Invite[]
  tables: TableMeta[]
  columns: Column[]
  records: RecordRow[]
  cells: Cell[]
  views: View[]
  audit: AuditEntry[]
  session: SessionState | null
  // --- Enrichment engine (Phase 2) ---
  providers: Provider[]
  providerCredentials: ProviderCredential[]
  enrichmentConfigs: EnrichmentColumnConfig[]
  enrichmentRuns: EnrichmentRun[]
  enrichmentResults: EnrichmentCellResult[]
  enrichmentCache: EnrichmentCache[]
  creditLedger: CreditLedgerEntry[]
  workspaceCredits: WorkspaceCredit[]
  // --- AI columns (Phase 3); reuse creditLedger + workspaceCredits ---
  aiColumnConfigs: AiColumnConfig[]
  aiRuns: EnrichmentRun[]
  aiResults: AiCellResult[]
  aiCache: AiCache[]
  // --- Web-research agent + HTTP + formula columns (Phase 3 rest) ---
  agentColumnConfigs: AgentColumnConfig[]
  agentRuns: EnrichmentRun[]
  agentResults: AgentCellResult[]
  agentCache: AgentCache[]
  httpColumnConfigs: HttpColumnConfig[]
  httpRuns: EnrichmentRun[]
  httpResults: HttpCellResult[]
  httpCache: HttpCache[]
  httpSecrets: HttpSecret[]
  formulaColumnConfigs: FormulaColumnConfig[]
  // --- Automation + integration layer (Phase 3 rest) ---
  automations: Automation[]
  automationRuns: AutomationRun[]
  inboundWebhooks: InboundWebhook[]
  outboundWebhooks: OutboundWebhook[]
  crmConnections: CrmConnection[]
  crmSyncRuns: CrmSyncRun[]
  slackConnections: SlackConnection[]
  integrationEvents: IntegrationEvent[]
  // --- Phase 4 growth: outbound sequencers + onboarding ---
  sequencerConnections: SequencerConnection[]
  sequencerPushRuns: SequencerPushRun[]
  onboardingStates: OnboardingState[]
  // --- SaaS billing + platform superadmin (Phase 4); billing reuses creditLedger ---
  plans: Plan[]
  subscriptions: Subscription[]
  creditPurchases: CreditPurchase[]
  invoices: Invoice[]
  platformUsers: PlatformUser[]
  platformAudit: PlatformAuditEntry[]
  platformSession: PlatformSessionState | null
}

export const STORAGE_KEY = 'cascade:store:v1'
// Bumped 1 → 2 for Phase-2 enrichment; 2 → 3 for Phase-3 AI columns; 3 → 4 for
// Phase-4 SaaS billing + platform superadmin; 4 → 5 for Phase-3 rest (agent /
// HTTP / formula columns + automation + integration layer); 5 → 6 for Phase-4
// growth (templates instantiate + outbound sequencers + onboarding). The load()
// version guard discards any older localStorage so it reseeds rather than
// merging a stale shape.
const SCHEMA_VERSION = 6

export function emptyStoreData(): StoreData {
  return {
    version: SCHEMA_VERSION,
    users: [],
    workspaces: [],
    members: [],
    invites: [],
    tables: [],
    columns: [],
    records: [],
    cells: [],
    views: [],
    audit: [],
    session: null,
    providers: [],
    providerCredentials: [],
    enrichmentConfigs: [],
    enrichmentRuns: [],
    enrichmentResults: [],
    enrichmentCache: [],
    creditLedger: [],
    workspaceCredits: [],
    aiColumnConfigs: [],
    aiRuns: [],
    aiResults: [],
    aiCache: [],
    agentColumnConfigs: [],
    agentRuns: [],
    agentResults: [],
    agentCache: [],
    httpColumnConfigs: [],
    httpRuns: [],
    httpResults: [],
    httpCache: [],
    httpSecrets: [],
    formulaColumnConfigs: [],
    automations: [],
    automationRuns: [],
    inboundWebhooks: [],
    outboundWebhooks: [],
    crmConnections: [],
    crmSyncRuns: [],
    slackConnections: [],
    integrationEvents: [],
    sequencerConnections: [],
    sequencerPushRuns: [],
    onboardingStates: [],
    plans: [],
    subscriptions: [],
    creditPurchases: [],
    invoices: [],
    platformUsers: [],
    platformAudit: [],
    platformSession: null,
  }
}

function cellKey(recordId: string, columnId: string): string {
  return `${recordId}|${columnId}`
}

export class Store {
  data: StoreData
  /** recordId|columnId → Cell, rebuilt on load / mutation for O(1) access. */
  private cellIndex = new Map<string, Cell>()
  /** cacheKey → EnrichmentCache; the cache is the one array that grows unbounded. */
  private cacheIndex = new Map<string, EnrichmentCache>()
  /** cacheKey → AiCache (Phase 3). */
  private aiCacheIndex = new Map<string, AiCache>()
  /** cacheKey → AgentCache (Phase 3 rest). */
  private agentCacheIndex = new Map<string, AgentCache>()
  /** cacheKey → HttpCache (Phase 3 rest). */
  private httpCacheIndex = new Map<string, HttpCache>()

  constructor(data: StoreData = emptyStoreData()) {
    this.data = data
    this.rebuildIndex()
  }

  rebuildIndex(): void {
    this.cellIndex.clear()
    for (const cell of this.data.cells) {
      this.cellIndex.set(cellKey(cell.recordId, cell.columnId), cell)
    }
    this.cacheIndex.clear()
    for (const entry of this.data.enrichmentCache) {
      this.cacheIndex.set(entry.cacheKey, entry)
    }
    this.aiCacheIndex.clear()
    for (const entry of this.data.aiCache) {
      this.aiCacheIndex.set(entry.cacheKey, entry)
    }
    this.agentCacheIndex.clear()
    for (const entry of this.data.agentCache) {
      this.agentCacheIndex.set(entry.cacheKey, entry)
    }
    this.httpCacheIndex.clear()
    for (const entry of this.data.httpCache) {
      this.httpCacheIndex.set(entry.cacheKey, entry)
    }
  }

  // --- cell access -------------------------------------------------------

  getCell(recordId: string, columnId: string): Cell | undefined {
    return this.cellIndex.get(cellKey(recordId, columnId))
  }

  /** Upsert a cell, keeping the array and the index consistent. */
  setCell(cell: Cell): void {
    const key = cellKey(cell.recordId, cell.columnId)
    const existing = this.cellIndex.get(key)
    if (existing) {
      existing.value = cell.value
      existing.meta = cell.meta
    } else {
      this.data.cells.push(cell)
      this.cellIndex.set(key, cell)
    }
  }

  /** Add many cells efficiently (used by seeding / bulk row generation). */
  addCells(cells: Cell[]): void {
    for (const cell of cells) {
      this.data.cells.push(cell)
      this.cellIndex.set(cellKey(cell.recordId, cell.columnId), cell)
    }
  }

  removeCellsForRecords(recordIds: Set<string>): void {
    this.data.cells = this.data.cells.filter((c) => {
      if (recordIds.has(c.recordId)) {
        this.cellIndex.delete(cellKey(c.recordId, c.columnId))
        return false
      }
      return true
    })
  }

  removeCellsForColumn(columnId: string): void {
    this.data.cells = this.data.cells.filter((c) => {
      if (c.columnId === columnId) {
        this.cellIndex.delete(cellKey(c.recordId, c.columnId))
        return false
      }
      return true
    })
  }

  // --- enrichment access -------------------------------------------------

  getCacheEntry(cacheKey: string): EnrichmentCache | undefined {
    return this.cacheIndex.get(cacheKey)
  }

  putCacheEntry(entry: EnrichmentCache): void {
    const existing = this.cacheIndex.get(entry.cacheKey)
    if (existing) {
      const i = this.data.enrichmentCache.indexOf(existing)
      if (i >= 0) this.data.enrichmentCache[i] = entry
    } else {
      this.data.enrichmentCache.push(entry)
    }
    this.cacheIndex.set(entry.cacheKey, entry)
  }

  getWorkspaceCredit(workspaceId: string): WorkspaceCredit | undefined {
    return this.data.workspaceCredits.find((w) => w.workspaceId === workspaceId)
  }

  getConfig(columnId: string): EnrichmentColumnConfig | undefined {
    return this.data.enrichmentConfigs.find((c) => c.columnId === columnId)
  }

  /** All enrichment configs whose anchor column belongs to a table. */
  getConfigsForTable(tableId: string): EnrichmentColumnConfig[] {
    const columnIds = new Set(this.data.columns.filter((c) => c.tableId === tableId).map((c) => c.id))
    return this.data.enrichmentConfigs.filter((c) => columnIds.has(c.columnId))
  }

  // --- AI column access (Phase 3) ----------------------------------------

  getAiCacheEntry(cacheKey: string): AiCache | undefined {
    return this.aiCacheIndex.get(cacheKey)
  }

  putAiCacheEntry(entry: AiCache): void {
    const existing = this.aiCacheIndex.get(entry.cacheKey)
    if (existing) {
      const i = this.data.aiCache.indexOf(existing)
      if (i >= 0) this.data.aiCache[i] = entry
    } else {
      this.data.aiCache.push(entry)
    }
    this.aiCacheIndex.set(entry.cacheKey, entry)
  }

  getAiConfig(columnId: string): AiColumnConfig | undefined {
    return this.data.aiColumnConfigs.find((c) => c.columnId === columnId)
  }

  /** All AI configs whose anchor column belongs to a table. */
  getAiConfigsForTable(tableId: string): AiColumnConfig[] {
    const columnIds = new Set(this.data.columns.filter((c) => c.tableId === tableId).map((c) => c.id))
    return this.data.aiColumnConfigs.filter((c) => columnIds.has(c.columnId))
  }

  // --- agent columns (Phase 3 rest) --------------------------------------

  getAgentCacheEntry(cacheKey: string): AgentCache | undefined {
    return this.agentCacheIndex.get(cacheKey)
  }

  putAgentCacheEntry(entry: AgentCache): void {
    const existing = this.agentCacheIndex.get(entry.cacheKey)
    if (existing) {
      const i = this.data.agentCache.indexOf(existing)
      if (i >= 0) this.data.agentCache[i] = entry
    } else {
      this.data.agentCache.push(entry)
    }
    this.agentCacheIndex.set(entry.cacheKey, entry)
  }

  getAgentConfig(columnId: string): AgentColumnConfig | undefined {
    return this.data.agentColumnConfigs.find((c) => c.columnId === columnId)
  }

  getAgentConfigsForTable(tableId: string): AgentColumnConfig[] {
    const columnIds = new Set(this.data.columns.filter((c) => c.tableId === tableId).map((c) => c.id))
    return this.data.agentColumnConfigs.filter((c) => columnIds.has(c.columnId))
  }

  // --- HTTP columns (Phase 3 rest) ---------------------------------------

  getHttpCacheEntry(cacheKey: string): HttpCache | undefined {
    return this.httpCacheIndex.get(cacheKey)
  }

  putHttpCacheEntry(entry: HttpCache): void {
    const existing = this.httpCacheIndex.get(entry.cacheKey)
    if (existing) {
      const i = this.data.httpCache.indexOf(existing)
      if (i >= 0) this.data.httpCache[i] = entry
    } else {
      this.data.httpCache.push(entry)
    }
    this.httpCacheIndex.set(entry.cacheKey, entry)
  }

  getHttpConfig(columnId: string): HttpColumnConfig | undefined {
    return this.data.httpColumnConfigs.find((c) => c.columnId === columnId)
  }

  getHttpConfigsForTable(tableId: string): HttpColumnConfig[] {
    const columnIds = new Set(this.data.columns.filter((c) => c.tableId === tableId).map((c) => c.id))
    return this.data.httpColumnConfigs.filter((c) => columnIds.has(c.columnId))
  }

  getHttpSecret(id: string): HttpSecret | undefined {
    return this.data.httpSecrets.find((s) => s.id === id)
  }

  // --- formula columns (Phase 3 rest) ------------------------------------

  getFormulaConfig(columnId: string): FormulaColumnConfig | undefined {
    return this.data.formulaColumnConfigs.find((c) => c.columnId === columnId)
  }

  getFormulaConfigsForTable(tableId: string): FormulaColumnConfig[] {
    const columnIds = new Set(this.data.columns.filter((c) => c.tableId === tableId).map((c) => c.id))
    return this.data.formulaColumnConfigs.filter((c) => columnIds.has(c.columnId))
  }

  // --- automation + integration (Phase 3 rest) ---------------------------

  getAutomation(id: string): Automation | undefined {
    return this.data.automations.find((a) => a.id === id)
  }

  getAutomationsForWorkspace(workspaceId: string): Automation[] {
    return this.data.automations.filter((a) => a.workspaceId === workspaceId)
  }

  getInboundWebhookBySlug(slug: string): InboundWebhook | undefined {
    return this.data.inboundWebhooks.find((w) => w.slug === slug)
  }

  getCrmConnection(id: string): CrmConnection | undefined {
    return this.data.crmConnections.find((c) => c.id === id)
  }

  getSlackConnection(workspaceId: string): SlackConnection | undefined {
    return this.data.slackConnections.find((s) => s.workspaceId === workspaceId)
  }

  getSequencerConnection(id: string): SequencerConnection | undefined {
    return this.data.sequencerConnections.find((s) => s.id === id)
  }

  getOnboardingState(workspaceId: string): OnboardingState | undefined {
    return this.data.onboardingStates.find((o) => o.workspaceId === workspaceId)
  }

  // --- SaaS billing access (Phase 4) -------------------------------------

  getSubscription(workspaceId: string): Subscription | undefined {
    return this.data.subscriptions.find((s) => s.workspaceId === workspaceId)
  }

  getPlan(planId: string): Plan | undefined {
    return this.data.plans.find((p) => p.id === planId)
  }

  // --- persistence -------------------------------------------------------

  serialize(): string {
    return JSON.stringify(this.data)
  }

  static deserialize(json: string): StoreData {
    const parsed = JSON.parse(json) as Partial<StoreData>
    const base = emptyStoreData()
    return { ...base, ...parsed, version: SCHEMA_VERSION }
  }

  /** Persist to localStorage if available. Silently degrades on quota/errors. */
  save(key: string = STORAGE_KEY): boolean {
    const ls = getLocalStorage()
    if (!ls) return false
    try {
      ls.setItem(key, this.serialize())
      return true
    } catch {
      // Quota exceeded (e.g. a 100k-row perf dataset) — stay memory-only.
      return false
    }
  }

  static load(key: string = STORAGE_KEY): Store | null {
    const ls = getLocalStorage()
    if (!ls) return null
    try {
      const json = ls.getItem(key)
      if (!json) return null
      // Guard on the *persisted* version, before deserialize() normalizes the
      // shape (it force-sets `version` to the current schema, so checking the
      // deserialized object here would always pass). A missing or mismatched
      // version means data written by an incompatible build: discard it so the
      // caller reseeds rather than merging a stale shape into the new one.
      const raw = JSON.parse(json) as Partial<StoreData>
      if (raw.version !== SCHEMA_VERSION) return null
      return new Store(Store.deserialize(json))
    } catch {
      return null
    }
  }

  static clear(key: string = STORAGE_KEY): void {
    const ls = getLocalStorage()
    if (ls) {
      try {
        ls.removeItem(key)
      } catch {
        /* ignore */
      }
    }
  }
}

function getLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    return ls ?? null
  } catch {
    return null
  }
}
