// MockApi — a full CascadeApi implementation over the in-memory Store.
//
// Responsibilities:
//  • Tenant isolation: every entity is resolved through its workspace and the
//    acting user's membership; non-members get NotFound (existence isn't leaked).
//  • Role guards: viewers cannot write; only owner/admin manage members + audit.
//  • Records list applies a view's (or ad-hoc) filters + sorts via @cascade/core.
//  • Cells patch is last-write-wins with an `expectedUpdatedAt` conflict guard.
//  • Audited actions (per the FSD) append immutable AuditEntry rows.
//  • Simulated ~40-120ms latency so the UI's async/loading states are exercised.

import type {
  AgentColumnConfig,
  AiColumnConfig,
  AiModelInfo,
  AuditAction,
  AuditTargetType,
  Automation,
  AutomationRun,
  AutomationRunStatus,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  CrmConnection,
  CrmProvider,
  CrmSyncDirection,
  CrmSyncRun,
  EnrichmentCellStatus,
  EnrichmentColumnConfig,
  EnrichmentOperation,
  EnrichmentRun,
  FormulaColumnConfig,
  HttpColumnConfig,
  InboundWebhook,
  IntegrationEvent,
  IntegrationEventSource,
  IntegrationEventStatus,
  Invite,
  Member,
  OutboundWebhook,
  Provider,
  ProviderCredential,
  RecordRow,
  Role,
  RowEvent,
  RowWithCells,
  RunScope,
  SlackConnection,
  TableMeta,
  User,
  View,
  Workspace,
} from '@cascade/core'
import type { FilterGroup, SortSpec } from '@cascade/core'
import {
  canIssueBillingExceptions,
  canManageAutomations,
  canManageBilling,
  canManageIntegrations,
  canManageMembers,
  canManageProviders,
  canManageSubscription,
  canOperateWorkspaces,
  canViewAudit,
  canViewMargin,
  canWrite,
  coerceColumnValue,
  columnTypeRegistry,
  defaultConfigFor,
  emptyFilter,
  evaluateFilter,
  evaluateFormula,
  extractFormulaRefs,
  makeComparator,
  newId,
  PLAN_RANK,
  readAgent,
  readAi,
  readEnrichment,
  readHttp,
  seatsExceeded,
  validateFormula,
  validateValue,
} from '@cascade/core'

import type {
  AddColumnInput,
  AddRecordInput,
  AgentApi,
  AgentEvent,
  AiApi,
  AiEvent,
  AuditApi,
  AuthApi,
  AutomationApi,
  BalanceInfo,
  BillingApi,
  BillingSummary,
  BudgetSettings,
  CacheStats,
  CascadeApi,
  CellEdit,
  CellsApi,
  CellUpdate,
  CellConflict,
  ColumnsApi,
  ConnectCrmInput,
  ConnectSlackInput,
  ConsumptionBucket,
  CreateViewInput,
  CreditsApi,
  EnrichmentApi,
  EnrichmentEvent,
  EstimateResult,
  FormulaApi,
  HttpApi,
  HttpEvent,
  InboundWebhookCreated,
  IntegrationApi,
  ListRecordsOptions,
  ListRecordsResult,
  MembersApi,
  PatchCellsResult,
  PlatformAnalytics,
  PlatformApi,
  PlatformSession,
  PlatformWorkspaceSummary,
  RecordsApi,
  RunHandle,
  RunOptions,
  SeatUsage,
  Session,
  TablesApi,
  UpdateColumnInput,
  UpsertAgentConfigInput,
  UpsertAiConfigInput,
  UpsertAutomationInput,
  UpsertConfigInput,
  UpsertCredentialInput,
  UpsertFormulaConfigInput,
  UpsertHttpConfigInput,
  UpsertInboundWebhookInput,
  UpsertOutboundWebhookInput,
  UpdateViewInput,
  ViewsApi,
  WorkspacesApi,
} from './api'
import type {
  CreditPurchase,
  Invoice,
  Plan,
  PlatformAuditEntry,
  PlatformUser,
  Subscription,
} from '@cascade/core'
import { ApiError, BudgetError, ForbiddenError, NotFoundError, ValidationError } from './errors'
import { STORAGE_KEY, Store } from './store'
import type { PlatformSessionState, SessionState, StoreData } from './store'
import { buildSeed, generateRows } from './seed'
import { PLANS, planById, planByTier } from './plans'
import { buildCacheKey, byoActive, isEmptyInput, MockEnrichmentEngine } from './enrichmentEngine'
import type { RunTarget } from './enrichmentEngine'
import { buildAiCacheKey, MockAiEngine } from './aiEngine'
import type { AiRunTarget } from './aiEngine'
import { buildAgentCacheKey, MockAgentEngine } from './agentEngine'
import type { AgentRunTarget } from './agentEngine'
import { buildHttpCacheKey, getJsonPath, MockHttpEngine } from './httpEngine'
import type { HttpRunTarget } from './httpEngine'
import { AI_MODELS, aiModelByKey, resolveAiModel } from './aiModels'

export interface MockApiOptions {
  /** Simulate network latency (default true). Disable for fast tests. */
  latency?: boolean
  storageKey?: string
  /** Override the initial dataset (defaults to the built-in seed). */
  seedData?: StoreData
  /** Enrichment engine tuning (tests run it synchronously). */
  enrichment?: { sync?: boolean }
}

/** A subscriber to enrichment events, filtered by run or table. */
interface EnrichmentListener {
  runId?: string
  tableId?: string
  cb: (e: EnrichmentEvent) => void
}

/** A subscriber to AI events, filtered by run or table. */
interface AiListener {
  runId?: string
  tableId?: string
  cb: (e: AiEvent) => void
}

/** A subscriber to agent events, filtered by run or table. */
interface AgentListener {
  runId?: string
  tableId?: string
  cb: (e: AgentEvent) => void
}

/** A subscriber to HTTP events, filtered by run or table. */
interface HttpListener {
  runId?: string
  tableId?: string
  cb: (e: HttpEvent) => void
}

export class MockApi implements CascadeApi {
  private store: Store
  private readonly key: string
  private readonly latencyOn: boolean
  private readonly engineSync: boolean
  private engine!: MockEnrichmentEngine
  private aiEngine!: MockAiEngine
  private agentEngine!: MockAgentEngine
  private httpEngine!: MockHttpEngine
  private listeners = new Set<EnrichmentListener>()
  private aiListeners = new Set<AiListener>()
  private agentListeners = new Set<AgentListener>()
  private httpListeners = new Set<HttpListener>()

  constructor(opts: MockApiOptions = {}) {
    this.latencyOn = opts.latency ?? true
    this.engineSync = opts.enrichment?.sync ?? false
    this.key = opts.storageKey ?? STORAGE_KEY
    const loaded = Store.load(this.key)
    if (loaded) {
      this.store = loaded
    } else {
      this.store = new Store(opts.seedData ?? buildSeed())
      this.store.save(this.key)
    }
    this.initEngine()
  }

  private initEngine(): void {
    const schedule = this.engineSync ? (fn: () => void) => fn() : (fn: () => void, ms: number) => setTimeout(fn, ms)
    this.engine = new MockEnrichmentEngine({
      store: this.store,
      persist: () => this.persist(),
      emit: (e) => this.emitEnrichment(e),
      now: () => new Date().toISOString(),
      schedule,
    })
    this.aiEngine = new MockAiEngine({
      store: this.store,
      persist: () => this.persist(),
      emit: (e) => this.emitAi(e),
      now: () => new Date().toISOString(),
      schedule,
    })
    this.agentEngine = new MockAgentEngine({
      store: this.store,
      persist: () => this.persist(),
      emit: (e) => this.emitAgent(e),
      now: () => new Date().toISOString(),
      schedule,
    })
    this.httpEngine = new MockHttpEngine({
      store: this.store,
      persist: () => this.persist(),
      emit: (e) => this.emitHttp(e),
      now: () => new Date().toISOString(),
      schedule,
    })
    this.engine.reconcileOnLoad()
    this.aiEngine.reconcileOnLoad()
    this.agentEngine.reconcileOnLoad()
    this.httpEngine.reconcileOnLoad()
  }

  private emitEnrichment(e: EnrichmentEvent): void {
    for (const l of this.listeners) {
      const runId = e.type === 'cell' ? e.runId : e.type === 'run' ? e.run.id : undefined
      const tableId = e.type === 'cell' ? e.tableId : e.type === 'run' ? e.run.tableId : undefined
      if (l.runId && l.runId !== runId) continue
      if (l.tableId && l.tableId !== tableId) continue
      try {
        l.cb(e)
      } catch {
        /* a subscriber throwing must not break the run */
      }
    }
  }

  private emitAi(e: AiEvent): void {
    for (const l of this.aiListeners) {
      const runId = e.type === 'cell' ? e.runId : e.type === 'run' ? e.run.id : undefined
      const tableId = e.type === 'cell' ? e.tableId : e.type === 'run' ? e.run.tableId : undefined
      if (l.runId && l.runId !== runId) continue
      if (l.tableId && l.tableId !== tableId) continue
      try {
        l.cb(e)
      } catch {
        /* a subscriber throwing must not break the run */
      }
    }
  }

  private emitAgent(e: AgentEvent): void {
    for (const l of this.agentListeners) {
      const runId = e.type === 'cell' ? e.runId : e.type === 'run' ? e.run.id : undefined
      const tableId = e.type === 'cell' ? e.tableId : e.type === 'run' ? e.run.tableId : undefined
      if (l.runId && l.runId !== runId) continue
      if (l.tableId && l.tableId !== tableId) continue
      try {
        l.cb(e)
      } catch {
        /* ignore */
      }
    }
  }

  private emitHttp(e: HttpEvent): void {
    for (const l of this.httpListeners) {
      const runId = e.type === 'cell' ? e.runId : e.type === 'run' ? e.run.id : undefined
      const tableId = e.type === 'cell' ? e.tableId : e.type === 'run' ? e.run.tableId : undefined
      if (l.runId && l.runId !== runId) continue
      if (l.tableId && l.tableId !== tableId) continue
      try {
        l.cb(e)
      } catch {
        /* ignore */
      }
    }
  }

  // ======================================================================
  // Infrastructure
  // ======================================================================

  private async delay(): Promise<void> {
    if (!this.latencyOn) return
    const ms = 40 + Math.floor(Math.random() * 80)
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private persist(): void {
    this.store.save(this.key)
  }

  private session(): SessionState {
    const s = this.store.data.session
    if (!s) throw new ApiError('Not authenticated', 'unauthenticated', 401)
    return s
  }

  private user(userId: string): User | undefined {
    return this.store.data.users.find((u) => u.id === userId)
  }

  /** The acting user's membership in a workspace, or undefined if not a member. */
  private membership(workspaceId: string): Member | undefined {
    const uid = this.session().userId
    return this.store.data.members.find(
      (m) => m.workspaceId === workspaceId && m.userId === uid && m.status === 'active',
    )
  }

  /** Acting user's role in a workspace; throws NotFound (isolation) if not a member. */
  private roleFor(workspaceId: string): Role {
    const m = this.membership(workspaceId)
    if (!m) throw new NotFoundError()
    return m.role
  }

  private assertWrite(role: Role): void {
    if (!canWrite(role)) throw new ForbiddenError('Viewers have read-only access')
  }
  private assertManageMembers(role: Role): void {
    if (!canManageMembers(role)) throw new ForbiddenError('Only owners and admins can manage members')
  }
  private assertAudit(role: Role): void {
    if (!canViewAudit(role)) throw new ForbiddenError('Only owners and admins can view the audit log')
  }

  private tableScope(tableId: string): { table: TableMeta; role: Role } {
    const table = this.store.data.tables.find((t) => t.id === tableId)
    if (!table) throw new NotFoundError('Table not found')
    const role = this.roleFor(table.workspaceId)
    return { table, role }
  }

  private columnScope(columnId: string): { column: Column; table: TableMeta; role: Role } {
    const column = this.store.data.columns.find((c) => c.id === columnId)
    if (!column) throw new NotFoundError('Column not found')
    const { table, role } = this.tableScope(column.tableId)
    return { column, table, role }
  }

  private columnsForTable(tableId: string): Column[] {
    return this.store.data.columns
      .filter((c) => c.tableId === tableId)
      .sort((a, b) => a.position - b.position)
  }

  private writeAudit(
    workspaceId: string,
    action: AuditAction,
    targetType: AuditTargetType,
    targetId: string,
    detail: Record<string, unknown>,
  ): void {
    const uid = this.session().userId
    this.store.data.audit.push({
      id: newId(),
      workspaceId,
      actorUserId: uid,
      actorName: this.user(uid)?.name ?? uid,
      action,
      targetType,
      targetId,
      detail,
      createdAt: new Date().toISOString(),
    })
  }

  // ======================================================================
  // Records helpers (filter + sort via @cascade/core)
  // ======================================================================

  private valuesFor(record: RecordRow, columns: Column[]): Record<string, CellValue> {
    const map: Record<string, CellValue> = {}
    for (const c of columns) {
      const cell = this.store.getCell(record.id, c.id)
      map[c.id] = cell ? cell.value : c.type === 'multiSelect' ? [] : null
    }
    return map
  }

  // Returns an immutable snapshot: the row and cells are freshly cloned so
  // callers never hold live references into the store (correct for React's
  // referential-equality model and safe against later in-place mutations).
  private toRowWithCells(record: RecordRow, columns: Column[]): RowWithCells {
    const cells: Record<string, Cell> = {}
    for (const c of columns) {
      const stored = this.store.getCell(record.id, c.id)
      cells[c.id] = stored
        ? { recordId: stored.recordId, columnId: stored.columnId, value: cloneValue(stored.value), meta: { ...stored.meta } }
        : { recordId: record.id, columnId: c.id, value: c.type === 'multiSelect' ? [] : null, meta: {} }
    }
    return { row: { ...record }, cells }
  }

  private filteredRecords(
    tableId: string,
    viewId?: string,
    filters?: FilterGroup,
    sorts?: SortSpec[],
  ): RecordRow[] {
    const columns = this.columnsForTable(tableId)
    const columnsById = Object.fromEntries(columns.map((c) => [c.id, c] as const))

    let activeFilter = filters
    let activeSorts = sorts
    if (viewId) {
      const view = this.store.data.views.find((v) => v.id === viewId && v.tableId === tableId)
      if (view) {
        if (activeFilter === undefined) activeFilter = view.filters
        if (activeSorts === undefined) activeSorts = view.sorts
      }
    }

    let records = this.store.data.records.filter((r) => r.tableId === tableId)

    const cache = new Map<string, Record<string, CellValue>>()
    const vals = (r: RecordRow) => {
      let m = cache.get(r.id)
      if (!m) {
        m = this.valuesFor(r, columns)
        cache.set(r.id, m)
      }
      return m
    }

    const f = activeFilter
    if (f && f.items.length) {
      records = records.filter((r) => evaluateFilter(vals(r), f, columnsById))
    }

    const s = activeSorts
    if (s && s.length) {
      const cmp = makeComparator(s, columnsById)
      records = records.slice().sort((a, b) => cmp(vals(a), vals(b)) || a.position - b.position)
    } else {
      records = records.slice().sort((a, b) => a.position - b.position)
    }
    return records
  }

  // ======================================================================
  // auth
  // ======================================================================

  private resolveSession(state: SessionState): Session {
    const user = this.user(state.userId)
    if (!user) throw new ApiError('Not authenticated', 'unauthenticated', 401)
    let workspaceId = state.workspaceId
    let m = this.store.data.members.find(
      (x) => x.workspaceId === workspaceId && x.userId === user.id && x.status === 'active',
    )
    if (!m) {
      m = this.store.data.members.find((x) => x.userId === user.id && x.status === 'active')
      if (m) workspaceId = m.workspaceId
    }
    return {
      user,
      workspaceId,
      role: m?.role ?? 'viewer',
      token: state.token,
      expiresAt: state.expiresAt,
    }
  }

  auth: AuthApi = {
    signIn: async (email: string) => {
      await this.delay()
      const user = this.store.data.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
      // Non-enumerating: same generic error whether or not the email exists.
      if (!user) throw new ApiError('Invalid email or password', 'invalid_credentials', 401)
      const m = this.store.data.members.find((x) => x.userId === user.id && x.status === 'active')
      const state: SessionState = {
        userId: user.id,
        workspaceId: m?.workspaceId ?? '',
        token: `mock-${newId()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }
      this.store.data.session = state
      this.persist()
      return this.resolveSession(state)
    },

    signUp: async (input) => {
      await this.delay()
      const email = input.email.trim().toLowerCase()
      if (this.store.data.users.some((u) => u.email.toLowerCase() === email)) {
        // Non-enumerating message per FSD US-1.1.
        throw new ValidationError('Could not create an account with those details')
      }
      const user: User = {
        id: newId(),
        email,
        name: input.name?.trim() || email.split('@')[0] || 'New user',
        emailVerified: false,
        createdAt: new Date().toISOString(),
      }
      const workspace: Workspace = {
        id: newId(),
        name: input.workspaceName?.trim() || `${user.name}'s workspace`,
        ownerUserId: user.id,
        createdAt: new Date().toISOString(),
        status: 'active',
      }
      const member: Member = {
        id: newId(),
        workspaceId: workspace.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: 'owner',
        status: 'active',
        invitedBy: null,
        createdAt: new Date().toISOString(),
      }
      this.store.data.users.push(user)
      this.store.data.workspaces.push(workspace)
      this.store.data.members.push(member)
      // US-4.1 — put the new workspace on the selected (or Free) plan.
      this.provisionBilling(workspace.id, input.planId)
      const state: SessionState = {
        userId: user.id,
        workspaceId: workspace.id,
        token: `mock-${newId()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }
      this.store.data.session = state
      this.persist()
      return this.resolveSession(state)
    },

    magicLink: async (_email: string) => {
      await this.delay()
      // Always report success (non-enumerating).
      return { sent: true as const }
    },

    currentSession: async () => {
      await this.delay()
      const s = this.store.data.session
      if (!s) return null
      try {
        return this.resolveSession(s)
      } catch {
        return null
      }
    },

    switchUser: async (userId: string) => {
      await this.delay()
      const user = this.user(userId)
      if (!user) throw new NotFoundError('User not found')
      const m = this.store.data.members.find((x) => x.userId === userId && x.status === 'active')
      const state: SessionState = {
        userId,
        workspaceId: m?.workspaceId ?? '',
        token: `mock-${newId()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }
      this.store.data.session = state
      this.persist()
      return this.resolveSession(state)
    },

    signOut: async () => {
      await this.delay()
      this.store.data.session = null
      this.persist()
    },
  }

  // ======================================================================
  // workspaces
  // ======================================================================

  workspaces: WorkspacesApi = {
    list: async () => {
      await this.delay()
      const uid = this.session().userId
      const wsIds = new Set(
        this.store.data.members.filter((m) => m.userId === uid && m.status === 'active').map((m) => m.workspaceId),
      )
      return snapList(this.store.data.workspaces.filter((w) => wsIds.has(w.id)))
    },

    get: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId) // membership / isolation check
      const ws = this.store.data.workspaces.find((w) => w.id === workspaceId)
      if (!ws) throw new NotFoundError('Workspace not found')
      return snap(ws)
    },

    create: async (input) => {
      await this.delay()
      const uid = this.session().userId
      const actor = this.user(uid)
      if (!actor) throw new ApiError('Not authenticated', 'unauthenticated', 401)
      const name = input.name.trim()
      if (!name) throw new ValidationError('Workspace name is required')
      const workspace: Workspace = { id: newId(), name, ownerUserId: uid, createdAt: new Date().toISOString(), status: 'active' }
      this.store.data.workspaces.push(workspace)
      this.store.data.members.push({
        id: newId(),
        workspaceId: workspace.id,
        userId: uid,
        email: actor.email,
        name: actor.name,
        role: 'owner',
        status: 'active',
        invitedBy: null,
        createdAt: new Date().toISOString(),
      })
      this.provisionBilling(workspace.id, undefined) // new workspaces start on Free
      this.persist()
      return snap(workspace)
    },
  }

  // ======================================================================
  // members
  // ======================================================================

  members: MembersApi = {
    list: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId)
      return snapList(this.store.data.members.filter((m) => m.workspaceId === workspaceId && m.status === 'active'))
    },

    invite: async (workspaceId: string, input) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertManageMembers(role)
      const email = input.email.trim().toLowerCase()
      if (!email) throw new ValidationError('Email is required')
      if (this.store.data.members.some((m) => m.workspaceId === workspaceId && m.email.toLowerCase() === email && m.status === 'active')) {
        throw new ValidationError('That email is already a member of this workspace')
      }
      if (this.store.data.invites.some((i) => i.workspaceId === workspaceId && i.email.toLowerCase() === email && i.status === 'pending')) {
        throw new ValidationError('An invitation is already pending for that email')
      }
      // US-4.14 — enforce the plan's seat limit (active members + pending invites).
      const plan = this.planFor(workspaceId)
      const seatsUsed = this.seatsUsed(workspaceId)
      if (seatsExceeded(plan, seatsUsed)) {
        throw new ValidationError(`Your plan includes ${plan?.seatLimit ?? 0} seats. Upgrade in Billing to invite more people.`)
      }
      const invite: Invite = {
        id: newId(),
        workspaceId,
        email,
        role: input.role,
        invitedBy: this.session().userId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
      this.store.data.invites.push(invite)
      this.writeAudit(workspaceId, 'member.invite', 'invite', invite.id, { email, role: input.role })
      this.persist()
      return snap(invite)
    },

    updateRole: async (workspaceId: string, memberId: string, newRole: Role) => {
      await this.delay()
      const actingRole = this.roleFor(workspaceId)
      this.assertManageMembers(actingRole)
      const member = this.store.data.members.find((m) => m.id === memberId && m.workspaceId === workspaceId)
      if (!member) throw new NotFoundError('Member not found')
      if (member.role === 'owner') throw new ForbiddenError('The workspace owner’s role cannot be changed')
      if (newRole === 'owner' && actingRole !== 'owner') {
        throw new ForbiddenError('Only the owner can transfer ownership')
      }
      const from = member.role
      member.role = newRole
      this.writeAudit(workspaceId, 'member.updateRole', 'member', memberId, { email: member.email, from, to: newRole })
      this.persist()
      return snap(member)
    },

    remove: async (workspaceId: string, memberId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertManageMembers(role)
      const member = this.store.data.members.find((m) => m.id === memberId && m.workspaceId === workspaceId)
      if (!member) throw new NotFoundError('Member not found')
      if (member.role === 'owner') throw new ForbiddenError('The workspace owner cannot be removed')
      this.store.data.members = this.store.data.members.filter((m) => m.id !== memberId)
      this.writeAudit(workspaceId, 'member.remove', 'member', memberId, { email: member.email })
      this.persist()
    },

    listPendingInvites: async (workspaceId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertManageMembers(role)
      return snapList(this.store.data.invites.filter((i) => i.workspaceId === workspaceId && i.status === 'pending'))
    },

    revokeInvite: async (workspaceId: string, inviteId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertManageMembers(role)
      const invite = this.store.data.invites.find((i) => i.id === inviteId && i.workspaceId === workspaceId)
      if (!invite) throw new NotFoundError('Invitation not found')
      invite.status = 'revoked'
      this.writeAudit(workspaceId, 'invite.revoke', 'invite', inviteId, { email: invite.email })
      this.persist()
    },
  }

  // ======================================================================
  // tables
  // ======================================================================

  private assertUniqueTableName(workspaceId: string, name: string, exceptId?: string): void {
    const clash = this.store.data.tables.some(
      (t) => t.workspaceId === workspaceId && t.id !== exceptId && t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (clash) throw new ValidationError('A table with that name already exists in this workspace')
  }

  tables: TablesApi = {
    list: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId)
      return snapList(this.store.data.tables.filter((t) => t.workspaceId === workspaceId))
    },

    get: async (tableId: string) => {
      await this.delay()
      return snap(this.tableScope(tableId).table)
    },

    create: async (workspaceId: string, input) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertWrite(role)
      const name = input.name.trim()
      if (!name) throw new ValidationError('Table name is required')
      this.assertUniqueTableName(workspaceId, name)
      const table: TableMeta = {
        id: newId(),
        workspaceId,
        name,
        createdBy: this.session().userId,
        createdAt: new Date().toISOString(),
      }
      this.store.data.tables.push(table)
      // Seed one default text column + an undeletable default view.
      const col: Column = {
        id: newId(),
        tableId: table.id,
        name: 'Name',
        type: 'text',
        config: defaultConfigFor('text'),
        position: 0,
        isFrozen: true,
        width: 200,
      }
      this.store.data.columns.push(col)
      this.store.data.views.push({
        id: newId(),
        tableId: table.id,
        name: 'All records',
        filters: emptyFilter(),
        sorts: [],
        columnState: [{ columnId: col.id, visible: true, position: 0, width: col.width }],
        isDefault: true,
      })
      this.writeAudit(workspaceId, 'table.create', 'table', table.id, { name })
      this.persist()
      return snap(table)
    },

    rename: async (tableId: string, name: string) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const trimmed = name.trim()
      if (!trimmed) throw new ValidationError('Table name is required')
      this.assertUniqueTableName(table.workspaceId, trimmed, table.id)
      const from = table.name
      table.name = trimmed
      this.writeAudit(table.workspaceId, 'table.rename', 'table', table.id, { from, to: trimmed })
      this.persist()
      return snap(table)
    },

    duplicate: async (tableId: string, input) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const name = (input?.name ?? `${table.name} copy`).trim()
      this.assertUniqueTableName(table.workspaceId, name)
      const newTable: TableMeta = {
        id: newId(),
        workspaceId: table.workspaceId,
        name,
        createdBy: this.session().userId,
        createdAt: new Date().toISOString(),
      }
      this.store.data.tables.push(newTable)

      const columns = this.columnsForTable(tableId)
      const colIdMap = new Map<string, string>()
      for (const c of columns) {
        const id = newId()
        colIdMap.set(c.id, id)
        this.store.data.columns.push({ ...c, id, tableId: newTable.id, config: JSON.parse(JSON.stringify(c.config)) })
      }

      if (input?.includeRecords) {
        const records = this.store.data.records
          .filter((r) => r.tableId === tableId)
          .sort((a, b) => a.position - b.position)
        for (const r of records) {
          const rid = newId()
          this.store.data.records.push({ ...r, id: rid, tableId: newTable.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          const newCells: Cell[] = []
          for (const c of columns) {
            const cell = this.store.getCell(r.id, c.id)
            if (!cell) continue
            const newColId = colIdMap.get(c.id)
            if (!newColId) continue
            newCells.push({ recordId: rid, columnId: newColId, value: cloneValue(cell.value), meta: {} })
          }
          this.store.addCells(newCells)
        }
      }

      this.store.data.views.push({
        id: newId(),
        tableId: newTable.id,
        name: 'All records',
        filters: emptyFilter(),
        sorts: [],
        columnState: this.columnsForTable(newTable.id).map((c) => ({ columnId: c.id, visible: true, position: c.position, width: c.width })),
        isDefault: true,
      })

      this.writeAudit(table.workspaceId, 'table.duplicate', 'table', newTable.id, { from: table.id, name, includeRecords: !!input?.includeRecords })
      this.persist()
      return snap(newTable)
    },

    remove: async (tableId: string) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const recordIds = new Set(this.store.data.records.filter((r) => r.tableId === tableId).map((r) => r.id))
      this.store.removeCellsForRecords(recordIds)
      this.store.data.records = this.store.data.records.filter((r) => r.tableId !== tableId)
      this.store.data.columns = this.store.data.columns.filter((c) => c.tableId !== tableId)
      this.store.data.views = this.store.data.views.filter((v) => v.tableId !== tableId)
      this.store.data.tables = this.store.data.tables.filter((t) => t.id !== tableId)
      this.writeAudit(table.workspaceId, 'table.delete', 'table', tableId, { name: table.name })
      this.persist()
    },
  }

  // ======================================================================
  // columns
  // ======================================================================

  columns: ColumnsApi = {
    list: async (tableId: string) => {
      await this.delay()
      this.tableScope(tableId)
      return snapList(this.columnsForTable(tableId))
    },

    add: async (tableId: string, input: AddColumnInput) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const name = input.name.trim()
      if (!name) throw new ValidationError('Column name is required')
      const existing = this.columnsForTable(tableId)
      const config = input.config ?? defaultConfigFor(input.type)
      const position = input.position ?? existing.length
      // Shift later columns to make room when inserting in the middle.
      for (const c of existing) {
        if (c.position >= position) c.position += 1
      }
      const column: Column = {
        id: newId(),
        tableId,
        name,
        type: input.type,
        config,
        position,
        isFrozen: input.isFrozen ?? false,
        width: input.width ?? 160,
      }
      this.store.data.columns.push(column)
      for (const v of this.store.data.views.filter((vw) => vw.tableId === tableId)) {
        v.columnState.push({ columnId: column.id, visible: true, position, width: column.width })
      }
      this.writeAudit(table.workspaceId, 'column.add', 'column', column.id, { name, type: input.type })
      this.persist()
      return snap(column)
    },

    update: async (columnId: string, patch: UpdateColumnInput) => {
      await this.delay()
      const { column, table, role } = this.columnScope(columnId)
      this.assertWrite(role)
      const detail: Record<string, unknown> = {}
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim()
        if (!trimmed) throw new ValidationError('Column name is required')
        detail.name = trimmed
        column.name = trimmed
      }
      if (patch.config !== undefined) column.config = patch.config
      if (patch.isFrozen !== undefined) column.isFrozen = patch.isFrozen
      if (patch.width !== undefined) column.width = patch.width
      this.writeAudit(table.workspaceId, 'column.update', 'column', columnId, detail)
      this.persist()
      return snap(column)
    },

    retype: async (columnId: string, toType: ColumnType, config?: ColumnConfig) => {
      await this.delay()
      const { column, table, role } = this.columnScope(columnId)
      this.assertWrite(role)
      const from: Column = { ...column }
      const toConfig = config ?? defaultConfigFor(toType)
      const to: Column = { ...column, type: toType, config: toConfig }
      let coerced = 0
      let lost = 0
      const records = this.store.data.records.filter((r) => r.tableId === table.id)
      for (const r of records) {
        const cell = this.store.getCell(r.id, columnId)
        if (!cell) continue
        const result = coerceColumnValue(from, to, cell.value)
        if (result.lossy) lost += 1
        if (JSON.stringify(result.value) !== JSON.stringify(cell.value)) coerced += 1
        this.store.setCell({ recordId: r.id, columnId, value: result.value, meta: cell.meta })
      }
      column.type = toType
      column.config = toConfig
      this.writeAudit(table.workspaceId, 'column.retype', 'column', columnId, { name: column.name, from: from.type, to: toType, coerced, lost })
      this.persist()
      return { column: snap(column), coerced, lost }
    },

    reorder: async (tableId: string, orderedColumnIds: string[]) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      orderedColumnIds.forEach((id, index) => {
        const col = this.store.data.columns.find((c) => c.id === id && c.tableId === tableId)
        if (col) col.position = index
      })
      this.writeAudit(table.workspaceId, 'column.reorder', 'table', tableId, { order: orderedColumnIds })
      this.persist()
      return snapList(this.columnsForTable(tableId))
    },

    remove: async (columnId: string) => {
      await this.delay()
      const { column, table, role } = this.columnScope(columnId)
      this.assertWrite(role)
      this.store.removeCellsForColumn(columnId)
      this.store.data.columns = this.store.data.columns.filter((c) => c.id !== columnId)
      for (const v of this.store.data.views.filter((vw) => vw.tableId === column.tableId)) {
        v.columnState = v.columnState.filter((cs) => cs.columnId !== columnId)
      }
      this.writeAudit(table.workspaceId, 'column.remove', 'column', columnId, { name: column.name })
      this.persist()
    },
  }

  // ======================================================================
  // records
  // ======================================================================

  records: RecordsApi = {
    list: async (tableId: string, opts?: ListRecordsOptions): Promise<ListRecordsResult> => {
      await this.delay()
      this.tableScope(tableId)
      const columns = this.columnsForTable(tableId)
      const filtered = this.filteredRecords(tableId, opts?.viewId, opts?.filters, opts?.sorts)
      const total = filtered.length
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? total
      const page = filtered.slice(offset, offset + limit)
      return { rows: page.map((r) => this.toRowWithCells(r, columns)), total }
    },

    count: async (tableId: string, viewId?: string) => {
      await this.delay()
      this.tableScope(tableId)
      return this.filteredRecords(tableId, viewId).length
    },

    add: async (tableId: string, input?: AddRecordInput): Promise<RowWithCells> => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const columns = this.columnsForTable(tableId)
      const existing = this.store.data.records.filter((r) => r.tableId === tableId)
      const position = input?.position ?? existing.length
      for (const r of existing) {
        if (r.position >= position) r.position += 1
      }
      const now = new Date().toISOString()
      const record: RecordRow = { id: newId(), tableId, position, createdAt: now, updatedAt: now }
      this.store.data.records.push(record)

      if (input?.cells) {
        const cells: Cell[] = []
        for (const c of columns) {
          const raw = input.cells[c.id]
          if (raw === undefined) continue
          const res = validateValue(c.type, raw, c.config)
          if (!res.ok) throw new ValidationError(res.error, { [c.id]: res.error })
          if (columnTypeRegistry[c.type].isEmpty(res.value)) continue
          cells.push({ recordId: record.id, columnId: c.id, value: res.value, meta: {} })
        }
        this.store.addCells(cells)
      }
      this.persist()
      // US-2.7 / US-3.8 — auto-run operations, recompute formulas, fire triggers.
      this.afterRecordsAdded(table, [record.id])
      return this.toRowWithCells(record, columns)
    },

    bulkDelete: async (tableId: string, recordIds: string[]) => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const idSet = new Set(recordIds)
      const toDelete = this.store.data.records.filter((r) => r.tableId === tableId && idSet.has(r.id))
      const deletedIds = new Set(toDelete.map((r) => r.id))
      this.store.removeCellsForRecords(deletedIds)
      this.store.data.records = this.store.data.records.filter((r) => !deletedIds.has(r.id))
      if (deletedIds.size > 0) {
        this.writeAudit(table.workspaceId, 'record.bulkDelete', 'record', tableId, { count: deletedIds.size })
      }
      this.persist()
      return { deleted: deletedIds.size }
    },

    reorder: async (tableId: string, recordId: string, toPosition: number) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      this.assertWrite(role)
      const records = this.store.data.records
        .filter((r) => r.tableId === tableId)
        .sort((a, b) => a.position - b.position)
      const idx = records.findIndex((r) => r.id === recordId)
      if (idx === -1) throw new NotFoundError('Record not found')
      const [moved] = records.splice(idx, 1)
      if (!moved) return
      const clamped = Math.max(0, Math.min(toPosition, records.length))
      records.splice(clamped, 0, moved)
      records.forEach((r, i) => {
        r.position = i
      })
      this.persist()
    },
  }

  // ======================================================================
  // cells
  // ======================================================================

  cells: CellsApi = {
    patch: async (edits: CellEdit[]): Promise<PatchCellsResult> => {
      await this.delay()
      const updated: CellUpdate[] = []
      const conflicts: CellConflict[] = []
      const now = new Date().toISOString()
      // Snapshot each record's updatedAt BEFORE any write so a multi-cell edit
      // of one row doesn't self-conflict on the second cell.
      const originalTs = new Map<string, string>()
      // Downstream reactions to fire once all writes land (US-3.6 / US-3.8 / US-3.10).
      const touched: Array<{ table: TableMeta; recordId: string; columnId: string; columnName: string }> = []

      for (const edit of edits) {
        const record = this.store.data.records.find((r) => r.id === edit.recordId)
        if (!record) throw new NotFoundError('Record not found')
        const { table, role } = this.tableScope(record.tableId)
        this.assertWrite(role)
        const column = this.store.data.columns.find((c) => c.id === edit.columnId && c.tableId === record.tableId)
        if (!column) throw new NotFoundError('Column not found')

        if (!originalTs.has(record.id)) originalTs.set(record.id, record.updatedAt)
        const baseTs = originalTs.get(record.id) as string

        if (edit.expectedUpdatedAt !== undefined && edit.expectedUpdatedAt !== baseTs) {
          const current = this.store.getCell(record.id, column.id)
          conflicts.push({
            recordId: record.id,
            columnId: column.id,
            currentValue: current ? current.value : null,
            currentUpdatedAt: record.updatedAt,
          })
          continue
        }

        const res = validateValue(column.type, edit.value, column.config)
        if (!res.ok) throw new ValidationError(res.error, { [column.id]: res.error })

        const existing = this.store.getCell(record.id, column.id)
        this.store.setCell({ recordId: record.id, columnId: column.id, value: res.value, meta: existing ? existing.meta : {} })
        record.updatedAt = now
        updated.push({ recordId: record.id, columnId: column.id, value: res.value, updatedAt: now })
        touched.push({ table, recordId: record.id, columnId: column.id, columnName: column.name })
      }

      // Recompute dependent formula cells, then fire record.updated triggers.
      for (const t of touched) this.recomputeFormulasForRecord(t.table.id, t.recordId, t.columnName)
      for (const t of touched) this.fireRowEvent(t.table, t.recordId, 'record.updated', t.columnId)

      this.persist()
      return { updated, conflicts }
    },
  }

  // ======================================================================
  // views
  // ======================================================================

  views: ViewsApi = {
    list: async (tableId: string) => {
      await this.delay()
      this.tableScope(tableId)
      return snapList(this.store.data.views.filter((v) => v.tableId === tableId))
    },

    create: async (tableId: string, input: CreateViewInput) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      this.assertWrite(role)
      const name = input.name.trim()
      if (!name) throw new ValidationError('View name is required')
      const columns = this.columnsForTable(tableId)
      const view: View = {
        id: newId(),
        tableId,
        name,
        filters: input.filters ?? emptyFilter(),
        sorts: input.sorts ?? [],
        columnState: input.columnState ?? columns.map((c) => ({ columnId: c.id, visible: true, position: c.position, width: c.width })),
        isDefault: false,
      }
      this.store.data.views.push(view)
      this.persist()
      return snap(view)
    },

    update: async (viewId: string, patch: UpdateViewInput) => {
      await this.delay()
      const view = this.store.data.views.find((v) => v.id === viewId)
      if (!view) throw new NotFoundError('View not found')
      const { role } = this.tableScope(view.tableId)
      this.assertWrite(role)
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim()
        if (!trimmed) throw new ValidationError('View name is required')
        view.name = trimmed
      }
      if (patch.filters !== undefined) view.filters = patch.filters
      if (patch.sorts !== undefined) view.sorts = patch.sorts
      if (patch.columnState !== undefined) view.columnState = patch.columnState
      this.persist()
      return snap(view)
    },

    remove: async (viewId: string) => {
      await this.delay()
      const view = this.store.data.views.find((v) => v.id === viewId)
      if (!view) throw new NotFoundError('View not found')
      const { role } = this.tableScope(view.tableId)
      this.assertWrite(role)
      if (view.isDefault) throw new ValidationError('The default view cannot be deleted')
      this.store.data.views = this.store.data.views.filter((v) => v.id !== viewId)
      this.persist()
    },
  }

  // ======================================================================
  // audit
  // ======================================================================

  audit: AuditApi = {
    list: async (workspaceId: string, opts?: { offset?: number; limit?: number }) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertAudit(role)
      const entries = this.store.data.audit
        .filter((a) => a.workspaceId === workspaceId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? entries.length
      return snapList(entries.slice(offset, offset + limit))
    },
  }

  // ======================================================================
  // enrichment
  // ======================================================================

  private assertManageBilling(role: Role): void {
    if (!canManageBilling(role)) throw new ForbiddenError('Only owners and admins can manage billing and provider keys')
  }

  private snapProvider(p: Provider, canMargin: boolean): Provider {
    if (canMargin) return { ...p, costConfig: { ...p.costConfig } }
    const costConfig: Provider['costConfig'] = {}
    for (const [op, c] of Object.entries(p.costConfig)) {
      if (c) costConfig[op as EnrichmentOperation] = { credits: c.credits, providerCostUsd: 0 }
    }
    return { ...p, costConfig }
  }

  private enrichmentCandidates(tableId: string, scope: RunScope): Array<{ recordId: string; config: EnrichmentColumnConfig }> {
    const configs = this.store
      .getConfigsForTable(tableId)
      .filter((c) => scope.columnIds.includes(c.columnId) && c.steps.length > 0)
    let recordIds: string[]
    if (scope.mode === 'selected') recordIds = scope.recordIds ?? []
    else recordIds = this.store.data.records.filter((r) => r.tableId === tableId).sort((a, b) => a.position - b.position).map((r) => r.id)
    const out: Array<{ recordId: string; config: EnrichmentColumnConfig }> = []
    for (const rid of recordIds) for (const config of configs) out.push({ recordId: rid, config })
    return out
  }

  private readStepInputs(recordId: string, step: EnrichmentColumnConfig['steps'][number]): Record<string, CellValue> {
    const inputs: Record<string, CellValue> = {}
    for (const [field, colId] of Object.entries(step.inputMapping)) {
      inputs[field] = this.store.getCell(recordId, colId)?.value ?? null
    }
    return inputs
  }

  /**
   * Validate + normalize a waterfall's steps before persisting (US-2.1): the
   * provider and operation must exist, mapped columns must belong to the table,
   * and acceptance conditions must be coherent. Credits/provider cost are always
   * re-derived from the provider's authoritative cost model so a client cannot
   * understate cost to slip past the per-run cap / budget or forge margin
   * (FR-2.4 / US-2.11 / US-2.12).
   */
  private validateSteps(table: TableMeta, steps: EnrichmentColumnConfig['steps']): EnrichmentColumnConfig['steps'] {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new ValidationError('An enrichment column needs at least one provider step')
    }
    const colIds = new Set(this.store.data.columns.filter((c) => c.tableId === table.id).map((c) => c.id))
    return steps.map((s, i) => {
      const n = i + 1
      const provider = this.store.data.providers.find((p) => p.id === s.providerId)
      if (!provider) throw new ValidationError(`Step ${n}: unknown provider`)
      const cost = provider.costConfig[s.operation]
      if (!cost) throw new ValidationError(`Step ${n}: ${provider.name} does not support “${s.operation}”`)
      if (s.acceptanceCondition === 'verifyDeliverable' && s.operation !== 'verify_email') {
        throw new ValidationError(`Step ${n}: “verify deliverable” only applies to an email-verification step`)
      }
      if (s.acceptanceCondition === 'nonEmptyField' && !s.acceptField) {
        throw new ValidationError(`Step ${n}: choose which returned field must be non-empty`)
      }
      if (s.acceptanceCondition === 'minConfidence' && (s.minConfidence == null || s.minConfidence < 0 || s.minConfidence > 1)) {
        throw new ValidationError(`Step ${n}: minimum confidence must be between 0 and 1`)
      }
      if (Object.keys(s.outputMapping).length === 0) {
        throw new ValidationError(`Step ${n}: map at least one returned field to a column`)
      }
      for (const colId of [...Object.values(s.inputMapping), ...Object.values(s.outputMapping)]) {
        if (!colIds.has(colId)) throw new ValidationError(`Step ${n}: maps to a column that isn’t in this table`)
      }
      return { ...s, credits: cost.credits, providerCostUsd: cost.providerCostUsd }
    })
  }

  private computeEstimate(tableId: string, scope: RunScope, forceFresh: boolean, canMargin: boolean): EstimateResult {
    const table = this.store.data.tables.find((t) => t.id === tableId)
    const wc = table ? this.store.getWorkspaceCredit(table.workspaceId) : undefined
    const cands = this.enrichmentCandidates(tableId, scope)
    let totalTargeted = 0
    let skippedCached = 0
    let skippedEmptyInput = 0
    let skippedAlreadyFilled = 0
    let maxCredits = 0
    let maxProviderCostUsd = 0
    let rows = 0
    const perColMap = new Map<string, { rows: number; maxCredits: number }>()

    for (const { recordId, config } of cands) {
      totalTargeted += 1
      const step0 = config.steps[0]
      if (!step0) continue
      const missing = Object.values(step0.inputMapping).some((colId) => isEmptyInput(this.store.getCell(recordId, colId)?.value ?? null))
      if (missing) {
        skippedEmptyInput += 1
        continue
      }
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readEnrichment(cell?.meta)
        // Skip already-populated cells, unless the last attempt failed (re-runnable).
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) {
          skippedAlreadyFilled += 1
          continue
        }
      }
      // Cost the row per-step, not per-row: a step0 cache hit does NOT make the
      // whole row free — later steps can still execute and charge. Check each
      // step's cache with the inputs resolvable *now* from the store; a step
      // whose inputs aren't yet resolvable (e.g. a verify step before the email
      // exists) is treated as billable so maxCredits stays a safe upper bound
      // for the per-run cap / budget gate (US-2.11), while a fully-cached row is
      // still recognised as free (US-2.9).
      const wsId = table?.workspaceId ?? ''
      let cCredits = 0
      let cUsd = 0
      for (const st of config.steps) {
        let stepCached = false
        if (!forceFresh) {
          const resolvable = Object.values(st.inputMapping).every(
            (colId) => !isEmptyInput(this.store.getCell(recordId, colId)?.value ?? null),
          )
          if (resolvable) {
            const key = buildCacheKey(st.providerId, st.operation, this.readStepInputs(recordId, st))
            const cached = this.store.getCacheEntry(key)
            if (cached && Date.parse(cached.expiresAt) > Date.now()) stepCached = true
          }
        }
        if (stepCached) continue
        cCredits += st.credits
        cUsd += byoActive(this.store.data.providerCredentials, wsId, st.providerId) ? 0 : st.providerCostUsd
      }
      if (cCredits === 0) {
        // Every billable step was served from cache — a free row.
        skippedCached += 1
        continue
      }
      rows += 1
      maxCredits += cCredits
      maxProviderCostUsd += cUsd
      const pc = perColMap.get(config.columnId) ?? { rows: 0, maxCredits: 0 }
      pc.rows += 1
      pc.maxCredits += cCredits
      perColMap.set(config.columnId, pc)
    }

    const perRunCap = wc?.perRunCap ?? Infinity
    const balance = wc?.balance ?? 0
    return {
      rows,
      totalTargeted,
      skippedCached,
      skippedEmptyInput,
      skippedAlreadyFilled,
      maxCredits,
      maxProviderCostUsd: canMargin ? maxProviderCostUsd : null,
      perColumn: [...perColMap.entries()].map(([columnId, v]) => ({ columnId, rows: v.rows, maxCredits: v.maxCredits })),
      blockedByPerRunCap: maxCredits > perRunCap,
      // Only billable work is blocked when the balance is exhausted; a fully
      // cache-served / missing-input run (maxCredits === 0) still runs (US-2.11
      // "non-billable actions continue").
      blockedByBudget: maxCredits > balance,
    }
  }

  private buildTargets(tableId: string, scope: RunScope): RunTarget[] {
    const cands = this.enrichmentCandidates(tableId, scope)
    const targets: RunTarget[] = []
    let order = 0
    for (const { recordId, config } of cands) {
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readEnrichment(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) continue
      }
      targets.push({ recordId, anchorColumnId: config.columnId, config, orderIndex: order++ })
    }
    return targets
  }

  private buildRun(table: TableMeta, scope: RunScope, forceFresh: boolean, total: number, triggeredByName: string): EnrichmentRun {
    const uid = this.store.data.session?.userId ?? ''
    const run: EnrichmentRun = {
      id: newId(),
      workspaceId: table.workspaceId,
      tableId: table.id,
      triggeredBy: uid,
      triggeredByName,
      scope,
      forceFresh,
      status: 'queued',
      counts: { processed: 0, total, success: 0, empty: 0, failed: 0, cached: 0 },
      creditsConsumed: 0,
      providerCostUsd: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    this.store.data.enrichmentRuns.push(run)
    return run
  }

  private triggerAutoRun(table: TableMeta, recordIds: string[]): void {
    if (!this.store.data.session) return
    this.engine.autoRun(table.id, recordIds, { id: this.store.data.session.userId, name: 'Auto-run' }, (targets) => {
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      if (!wc || wc.balance <= 0) return null
      const cols = [...new Set(targets.map((t) => t.anchorColumnId))]
      const est = this.computeEstimate(table.id, { mode: 'selected', recordIds, columnIds: cols }, false, true)
      if (est.maxCredits > wc.perRunCap) return null
      return this.buildRun(table, { mode: 'selected', recordIds, columnIds: cols }, false, targets.length, 'Auto-run')
    })
  }

  private snapRun(run: EnrichmentRun, canMargin: boolean): EnrichmentRun {
    return { ...run, counts: { ...run.counts }, scope: { ...run.scope }, providerCostUsd: canMargin ? run.providerCostUsd : 0 }
  }

  enrichment: EnrichmentApi = {
    providers: {
      list: async (workspaceId: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        const canMargin = canViewMargin(role)
        return this.store.data.providers.map((p) => this.snapProvider(p, canMargin))
      },
    },

    credentials: {
      list: async (workspaceId: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        if (!canManageProviders(role)) throw new ForbiddenError('Only owners and admins can view provider credentials')
        return snapList(this.store.data.providerCredentials.filter((c) => c.workspaceId === workspaceId))
      },
      upsert: async (workspaceId: string, input: UpsertCredentialInput) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageBilling(role)
        const provider = this.store.data.providers.find((p) => p.id === input.providerId)
        if (!provider) throw new NotFoundError('Provider not found')
        const platformManaged = !input.useByoKey
        const key = (input.apiKey ?? '').trim()
        const status: ProviderCredential['status'] = platformManaged ? 'active' : key.length >= 8 ? 'active' : 'invalid'
        const maskedKey = platformManaged ? '••••managed' : key.length >= 4 ? `••••${key.slice(-4)}` : '••••'
        let cred = this.store.data.providerCredentials.find((c) => c.workspaceId === workspaceId && c.providerId === input.providerId)
        if (cred) {
          cred.isPlatformManaged = platformManaged
          cred.maskedKey = maskedKey
          cred.status = status
        } else {
          cred = { id: newId(), workspaceId, providerId: input.providerId, isPlatformManaged: platformManaged, maskedKey, status, createdAt: new Date().toISOString() }
          this.store.data.providerCredentials.push(cred)
        }
        this.writeAudit(workspaceId, 'provider.keyUpdate', 'provider', input.providerId, { provider: provider.name, byo: input.useByoKey })
        this.persist()
        return snap(cred)
      },
      remove: async (workspaceId: string, credentialId: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageBilling(role)
        const cred = this.store.data.providerCredentials.find((c) => c.id === credentialId && c.workspaceId === workspaceId)
        if (!cred) throw new NotFoundError('Credential not found')
        this.store.data.providerCredentials = this.store.data.providerCredentials.filter((c) => c.id !== credentialId)
        this.writeAudit(workspaceId, 'provider.keyUpdate', 'provider', cred.providerId, { removed: true })
        this.persist()
      },
    },

    configs: {
      get: async (columnId: string) => {
        await this.delay()
        this.columnScope(columnId)
        const cfg = this.store.getConfig(columnId)
        return cfg ? snap(cfg) : null
      },
      list: async (tableId: string) => {
        await this.delay()
        this.tableScope(tableId)
        return snapList(this.store.getConfigsForTable(tableId))
      },
      upsert: async (input: UpsertConfigInput) => {
        await this.delay()
        const { column, table, role } = this.columnScope(input.columnId)
        this.assertWrite(role)
        const steps = this.validateSteps(table, input.steps)
        let cfg = this.store.getConfig(input.columnId)
        if (cfg) {
          cfg.steps = steps
          if (input.autoRun !== undefined) cfg.autoRun = input.autoRun
          if (input.forceFreshDefault !== undefined) cfg.forceFreshDefault = input.forceFreshDefault
        } else {
          cfg = {
            id: newId(),
            columnId: input.columnId,
            autoRun: input.autoRun ?? false,
            forceFreshDefault: input.forceFreshDefault ?? false,
            steps,
          }
          this.store.data.enrichmentConfigs.push(cfg)
        }
        this.writeAudit(table.workspaceId, 'column.enrich', 'enrichmentColumn', input.columnId, { name: column.name, steps: steps.length })
        this.persist()
        return snap(cfg)
      },
      remove: async (columnId: string) => {
        await this.delay()
        const { table, role } = this.columnScope(columnId)
        this.assertWrite(role)
        this.store.data.enrichmentConfigs = this.store.data.enrichmentConfigs.filter((c) => c.columnId !== columnId)
        this.writeAudit(table.workspaceId, 'column.enrich', 'enrichmentColumn', columnId, { removed: true })
        this.persist()
      },
    },

    runs: {
      list: async (workspaceId: string, opts) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        const canMargin = canViewMargin(role)
        let runs = this.store.data.enrichmentRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.tableId) runs = runs.filter((r) => r.tableId === opts.tableId)
        runs = runs.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        const offset = opts?.offset ?? 0
        const limit = opts?.limit ?? runs.length
        return runs.slice(offset, offset + limit).map((r) => this.snapRun(r, canMargin))
      },
      get: async (runId: string) => {
        await this.delay()
        const run = this.store.data.enrichmentRuns.find((r) => r.id === runId)
        if (!run) throw new NotFoundError('Run not found')
        const role = this.roleFor(run.workspaceId)
        return this.snapRun(run, canViewMargin(role))
      },
    },

    estimate: async (tableId: string, scope: RunScope, opts) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      return this.computeEstimate(tableId, scope, opts?.forceFresh ?? false, canViewMargin(role))
    },

    run: async (tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle> => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const forceFresh = opts?.forceFresh ?? false
      const est = this.computeEstimate(tableId, scope, forceFresh, canViewMargin(role))
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      const perRunCap = wc?.perRunCap ?? Infinity
      const balance = wc?.balance ?? 0
      // A billable run at an exhausted balance is paused (US-2.11); a fully
      // cache-served / missing-input run (maxCredits === 0) is non-billable and
      // still proceeds so results populate at zero cost.
      if (balance <= 0 && est.maxCredits > 0) {
        throw new BudgetError('The workspace budget is exhausted — enrichment is paused', { maxCredits: est.maxCredits, cap: perRunCap })
      }
      if (est.maxCredits > perRunCap) {
        throw new BudgetError(`This run could use up to ${est.maxCredits.toLocaleString('en-US')} credits, above the per-run cap of ${perRunCap.toLocaleString('en-US')}`, { maxCredits: est.maxCredits, cap: perRunCap })
      }
      const targets = this.buildTargets(tableId, scope)
      const run = this.buildRun(table, scope, forceFresh, targets.length, this.user(this.session().userId)?.name ?? 'Someone')
      this.writeAudit(table.workspaceId, 'enrichment.run', 'enrichmentRun', run.id, { mode: scope.mode, columns: scope.columnIds.length, rows: targets.length, forceFresh })
      this.persist()
      this.engine.startRun(run, targets)
      return { runId: run.id }
    },

    results: async (recordId: string, columnId: string) => {
      await this.delay()
      const { role } = this.columnScope(columnId)
      const canMargin = canViewMargin(role)
      return this.store.data.enrichmentResults
        .filter((r) => r.recordId === recordId && r.columnId === columnId)
        .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : a.fetchedAt > b.fetchedAt ? -1 : 0))
        .map((r) => ({ ...r, providerCostUsd: canMargin ? r.providerCostUsd : 0 }))
    },

    cacheStats: async (workspaceId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      const canMargin = canViewMargin(role)
      const runIds = new Set(this.store.data.enrichmentRuns.filter((r) => r.workspaceId === workspaceId).map((r) => r.id))
      let savedCr = 0
      let savedUsd = 0
      for (const r of this.store.data.enrichmentResults) {
        if (!r.fromCache || !runIds.has(r.runId)) continue
        const cfg = this.store.getConfig(r.columnId)
        const step = r.stepIndex != null ? cfg?.steps[r.stepIndex] : undefined
        if (step) {
          savedCr += step.credits
          savedUsd += step.providerCostUsd
        }
      }
      const stats: CacheStats = { entries: this.store.data.enrichmentCache.length, hitSavingsCredits: savedCr, hitSavingsUsd: canMargin ? savedUsd : null }
      return stats
    },

    subscribe: (target, cb) => {
      const listener = { runId: target.runId, tableId: target.tableId, cb }
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    },
  }

  // ======================================================================
  // AI columns (Phase 3) — mirrors the enrichment namespace + helpers
  // ======================================================================

  private snapAiModel(m: AiModelInfo, canMargin: boolean): AiModelInfo {
    return canMargin ? { ...m } : { ...m, providerCostUsd: 0 }
  }

  private snapAiRun(run: EnrichmentRun, canMargin: boolean): EnrichmentRun {
    return { ...run, counts: { ...run.counts }, scope: { ...run.scope }, providerCostUsd: canMargin ? run.providerCostUsd : 0 }
  }

  private aiCandidates(tableId: string, scope: RunScope): Array<{ recordId: string; config: AiColumnConfig }> {
    const configs = this.store.getAiConfigsForTable(tableId).filter((c) => scope.columnIds.includes(c.columnId))
    let recordIds: string[]
    if (scope.mode === 'selected') recordIds = scope.recordIds ?? []
    else recordIds = this.store.data.records.filter((r) => r.tableId === tableId).sort((a, b) => a.position - b.position).map((r) => r.id)
    const out: Array<{ recordId: string; config: AiColumnConfig }> = []
    for (const rid of recordIds) for (const config of configs) out.push({ recordId: rid, config })
    return out
  }

  /**
   * Validate + normalize an AI column config before persisting (US-3.1/3.2). The
   * model must exist and credits are re-derived from the model catalog so a
   * client cannot understate cost to slip past the per-run cap / budget.
   */
  private validateAiConfig(table: TableMeta, input: UpsertAiConfigInput): {
    model: AiColumnConfig['model']
    operation: AiColumnConfig['operation']
    promptTemplate: string
    outputSchema: AiColumnConfig['outputSchema']
    outputMapping: Record<string, string>
    credits: number
    providerCostUsd: number
  } {
    const prompt = (input.promptTemplate ?? '').trim()
    if (!prompt) throw new ValidationError('Write a prompt for the AI column')
    const modelInfo = resolveAiModel(input.model)
    if (!modelInfo) throw new ValidationError('Choose a valid model')
    const schema = input.outputSchema ?? []
    const mapping = input.outputMapping ?? {}
    const colIds = new Set(this.store.data.columns.filter((c) => c.tableId === table.id).map((c) => c.id))
    const seen = new Set<string>()
    for (const field of schema) {
      const name = field.name?.trim()
      if (!name) throw new ValidationError('Each output field needs a name')
      if (seen.has(name.toLowerCase())) throw new ValidationError(`Duplicate output field “${name}”`)
      seen.add(name.toLowerCase())
      const destId = mapping[field.name]
      if (destId && !colIds.has(destId)) throw new ValidationError(`Field “${name}” maps to a column that isn’t in this table`)
    }
    return { model: input.model, operation: input.operation, promptTemplate: prompt, outputSchema: schema, outputMapping: mapping, credits: modelInfo.credits, providerCostUsd: modelInfo.providerCostUsd }
  }

  private computeAiEstimate(tableId: string, scope: RunScope, forceFresh: boolean, canMargin: boolean): EstimateResult {
    const table = this.store.data.tables.find((t) => t.id === tableId)
    const wc = table ? this.store.getWorkspaceCredit(table.workspaceId) : undefined
    const cands = this.aiCandidates(tableId, scope)
    let totalTargeted = 0
    let skippedCached = 0
    let skippedEmptyInput = 0
    let skippedAlreadyFilled = 0
    let maxCredits = 0
    let maxProviderCostUsd = 0
    let rows = 0
    const perColMap = new Map<string, { rows: number; maxCredits: number }>()

    for (const { recordId, config } of cands) {
      totalTargeted += 1
      const modelInfo = resolveAiModel(config.model)
      if (!modelInfo) continue // unknown model — not billable (surfaces as Failed at run time)
      if (!this.aiEngine.refsPresent(recordId, config)) {
        // A missing {{reference}} → Empty, free (US-3.1).
        skippedEmptyInput += 1
        continue
      }
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readAi(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) {
          skippedAlreadyFilled += 1
          continue
        }
      }
      if (!forceFresh) {
        const resolved = this.aiEngine.resolvedPromptFor(recordId, config)
        const key = buildAiCacheKey(modelInfo.key, config.operation, resolved)
        const cached = this.store.getAiCacheEntry(key)
        if (cached && Date.parse(cached.expiresAt) > Date.now()) {
          skippedCached += 1
          continue
        }
      }
      rows += 1
      maxCredits += config.credits
      maxProviderCostUsd += config.providerCostUsd
      const pc = perColMap.get(config.columnId) ?? { rows: 0, maxCredits: 0 }
      pc.rows += 1
      pc.maxCredits += config.credits
      perColMap.set(config.columnId, pc)
    }

    const perRunCap = wc?.perRunCap ?? Infinity
    const balance = wc?.balance ?? 0
    return {
      rows,
      totalTargeted,
      skippedCached,
      skippedEmptyInput,
      skippedAlreadyFilled,
      maxCredits,
      maxProviderCostUsd: canMargin ? maxProviderCostUsd : null,
      perColumn: [...perColMap.entries()].map(([columnId, v]) => ({ columnId, rows: v.rows, maxCredits: v.maxCredits })),
      blockedByPerRunCap: maxCredits > perRunCap,
      blockedByBudget: maxCredits > balance,
    }
  }

  private buildAiTargets(tableId: string, scope: RunScope): AiRunTarget[] {
    const cands = this.aiCandidates(tableId, scope)
    const targets: AiRunTarget[] = []
    let order = 0
    for (const { recordId, config } of cands) {
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readAi(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) continue
      }
      targets.push({ recordId, anchorColumnId: config.columnId, config, orderIndex: order++ })
    }
    return targets
  }

  private buildAiRun(table: TableMeta, scope: RunScope, forceFresh: boolean, total: number, triggeredByName: string): EnrichmentRun {
    const uid = this.store.data.session?.userId ?? ''
    const run: EnrichmentRun = {
      id: newId(),
      workspaceId: table.workspaceId,
      tableId: table.id,
      triggeredBy: uid,
      triggeredByName,
      scope,
      forceFresh,
      status: 'queued',
      counts: { processed: 0, total, success: 0, empty: 0, failed: 0, cached: 0 },
      creditsConsumed: 0,
      providerCostUsd: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    this.store.data.aiRuns.push(run)
    return run
  }

  private triggerAiAutoRun(table: TableMeta, recordIds: string[]): void {
    if (!this.store.data.session) return
    this.aiEngine.autoRun(table.id, recordIds, (targets) => {
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      if (!wc || wc.balance <= 0) return null
      const cols = [...new Set(targets.map((t) => t.anchorColumnId))]
      const est = this.computeAiEstimate(table.id, { mode: 'selected', recordIds, columnIds: cols }, false, true)
      if (est.maxCredits > wc.perRunCap) return null
      return this.buildAiRun(table, { mode: 'selected', recordIds, columnIds: cols }, false, targets.length, 'Auto-run')
    })
  }

  /**
   * After new rows are added (manual add or inbound webhook): auto-run every
   * operation kind, compute formulas, then fire `record.created` triggers.
   */
  private afterRecordsAdded(table: TableMeta, recordIds: string[]): void {
    this.triggerAutoRun(table, recordIds)
    this.triggerAiAutoRun(table, recordIds)
    this.triggerAgentAutoRun(table, recordIds)
    this.triggerHttpAutoRun(table, recordIds)
    for (const rid of recordIds) this.recomputeFormulasForRecord(table.id, rid)
    for (const rid of recordIds) this.fireRowEvent(table, rid, 'record.created')
  }

  ai: AiApi = {
    models: {
      list: async (workspaceId: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        const canMargin = canViewMargin(role)
        return AI_MODELS.map((m) => this.snapAiModel(m, canMargin))
      },
    },

    configs: {
      get: async (columnId: string) => {
        await this.delay()
        this.columnScope(columnId)
        const cfg = this.store.getAiConfig(columnId)
        return cfg ? snap(cfg) : null
      },
      list: async (tableId: string) => {
        await this.delay()
        this.tableScope(tableId)
        return snapList(this.store.getAiConfigsForTable(tableId))
      },
      upsert: async (input: UpsertAiConfigInput) => {
        await this.delay()
        const { column, table, role } = this.columnScope(input.columnId)
        this.assertWrite(role)
        const v = this.validateAiConfig(table, input)
        let cfg = this.store.getAiConfig(input.columnId)
        if (cfg) {
          cfg.model = v.model
          cfg.operation = v.operation
          cfg.promptTemplate = v.promptTemplate
          cfg.outputSchema = v.outputSchema
          cfg.outputMapping = v.outputMapping
          cfg.credits = v.credits
          cfg.providerCostUsd = v.providerCostUsd
          if (input.cacheTtlDays !== undefined) cfg.cacheTtlDays = input.cacheTtlDays
          if (input.autoRun !== undefined) cfg.autoRun = input.autoRun
          if (input.forceFreshDefault !== undefined) cfg.forceFreshDefault = input.forceFreshDefault
        } else {
          cfg = {
            id: newId(),
            columnId: input.columnId,
            model: v.model,
            operation: v.operation,
            promptTemplate: v.promptTemplate,
            outputSchema: v.outputSchema,
            outputMapping: v.outputMapping,
            cacheTtlDays: input.cacheTtlDays ?? 30,
            autoRun: input.autoRun ?? false,
            forceFreshDefault: input.forceFreshDefault ?? false,
            credits: v.credits,
            providerCostUsd: v.providerCostUsd,
          }
          this.store.data.aiColumnConfigs.push(cfg)
        }
        this.writeAudit(table.workspaceId, 'column.aiConfig', 'aiColumn', input.columnId, { name: column.name, model: v.model.model })
        this.persist()
        return snap(cfg)
      },
      remove: async (columnId: string) => {
        await this.delay()
        const { table, role } = this.columnScope(columnId)
        this.assertWrite(role)
        this.store.data.aiColumnConfigs = this.store.data.aiColumnConfigs.filter((c) => c.columnId !== columnId)
        this.writeAudit(table.workspaceId, 'column.aiConfig', 'aiColumn', columnId, { removed: true })
        this.persist()
      },
    },

    runs: {
      list: async (workspaceId: string, opts) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        const canMargin = canViewMargin(role)
        let runs = this.store.data.aiRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.tableId) runs = runs.filter((r) => r.tableId === opts.tableId)
        runs = runs.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        const offset = opts?.offset ?? 0
        const limit = opts?.limit ?? runs.length
        return runs.slice(offset, offset + limit).map((r) => this.snapAiRun(r, canMargin))
      },
      get: async (runId: string) => {
        await this.delay()
        const run = this.store.data.aiRuns.find((r) => r.id === runId)
        if (!run) throw new NotFoundError('Run not found')
        const role = this.roleFor(run.workspaceId)
        return this.snapAiRun(run, canViewMargin(role))
      },
    },

    estimate: async (tableId: string, scope: RunScope, opts) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      return this.computeAiEstimate(tableId, scope, opts?.forceFresh ?? false, canViewMargin(role))
    },

    run: async (tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle> => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const forceFresh = opts?.forceFresh ?? false
      const est = this.computeAiEstimate(tableId, scope, forceFresh, canViewMargin(role))
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      const perRunCap = wc?.perRunCap ?? Infinity
      const balance = wc?.balance ?? 0
      if (balance <= 0 && est.maxCredits > 0) {
        throw new BudgetError('The workspace budget is exhausted — AI columns are paused', { maxCredits: est.maxCredits, cap: perRunCap })
      }
      if (est.maxCredits > perRunCap) {
        throw new BudgetError(`This run could use up to ${est.maxCredits.toLocaleString('en-US')} credits, above the per-run cap of ${perRunCap.toLocaleString('en-US')}`, { maxCredits: est.maxCredits, cap: perRunCap })
      }
      const targets = this.buildAiTargets(tableId, scope)
      const run = this.buildAiRun(table, scope, forceFresh, targets.length, this.user(this.session().userId)?.name ?? 'Someone')
      this.writeAudit(table.workspaceId, 'ai.run', 'aiRun', run.id, { mode: scope.mode, columns: scope.columnIds.length, rows: targets.length, forceFresh })
      this.persist()
      this.aiEngine.startRun(run, targets)
      return { runId: run.id }
    },

    results: async (recordId: string, columnId: string) => {
      await this.delay()
      const { role } = this.columnScope(columnId)
      const canMargin = canViewMargin(role)
      return this.store.data.aiResults
        .filter((r) => r.recordId === recordId && r.columnId === columnId)
        .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : a.fetchedAt > b.fetchedAt ? -1 : 0))
        .map((r) => ({ ...r, providerCostUsd: canMargin ? r.providerCostUsd : 0 }))
    },

    cacheStats: async (workspaceId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      const canMargin = canViewMargin(role)
      const runIds = new Set(this.store.data.aiRuns.filter((r) => r.workspaceId === workspaceId).map((r) => r.id))
      let savedCr = 0
      let savedUsd = 0
      for (const r of this.store.data.aiResults) {
        if (!r.fromCache || !runIds.has(r.runId)) continue
        const cfg = this.store.getAiConfig(r.columnId)
        if (cfg) {
          savedCr += cfg.credits
          savedUsd += cfg.providerCostUsd
        }
      }
      const stats: CacheStats = { entries: this.store.data.aiCache.length, hitSavingsCredits: savedCr, hitSavingsUsd: canMargin ? savedUsd : null }
      return stats
    },

    subscribe: (target, cb) => {
      const listener: AiListener = { runId: target.runId, tableId: target.tableId, cb }
      this.aiListeners.add(listener)
      return () => {
        this.aiListeners.delete(listener)
      }
    },
  }

  // ======================================================================
  // Generic metered-op helpers (shared by agent + HTTP columns; AI keeps its
  // own bespoke copy). A metered config has a columnId + credits + USD cost.
  // ======================================================================

  private meteredCandidates<C extends { columnId: string }>(
    tableId: string,
    scope: RunScope,
    getConfigs: (tableId: string) => C[],
  ): Array<{ recordId: string; config: C }> {
    const configs = getConfigs(tableId).filter((c) => scope.columnIds.includes(c.columnId))
    let recordIds: string[]
    if (scope.mode === 'selected') recordIds = scope.recordIds ?? []
    else recordIds = this.store.data.records.filter((r) => r.tableId === tableId).sort((a, b) => a.position - b.position).map((r) => r.id)
    const out: Array<{ recordId: string; config: C }> = []
    for (const rid of recordIds) for (const config of configs) out.push({ recordId: rid, config })
    return out
  }

  private computeMeteredEstimate<C extends { columnId: string; credits: number; providerCostUsd: number }>(
    tableId: string,
    scope: RunScope,
    forceFresh: boolean,
    canMargin: boolean,
    getConfigs: (tableId: string) => C[],
    refsPresent: (recordId: string, c: C) => boolean,
    readMeta: (meta: Cell['meta'] | undefined) => { status: EnrichmentCellStatus } | undefined,
    cacheWarm: (recordId: string, c: C) => boolean,
  ): EstimateResult {
    const table = this.store.data.tables.find((t) => t.id === tableId)
    const wc = table ? this.store.getWorkspaceCredit(table.workspaceId) : undefined
    const cands = this.meteredCandidates(tableId, scope, getConfigs)
    let totalTargeted = 0
    let skippedCached = 0
    let skippedEmptyInput = 0
    let skippedAlreadyFilled = 0
    let maxCredits = 0
    let maxProviderCostUsd = 0
    let rows = 0
    const perColMap = new Map<string, { rows: number; maxCredits: number }>()

    for (const { recordId, config } of cands) {
      totalTargeted += 1
      if (!refsPresent(recordId, config)) {
        skippedEmptyInput += 1
        continue
      }
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readMeta(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) {
          skippedAlreadyFilled += 1
          continue
        }
      }
      if (!forceFresh && cacheWarm(recordId, config)) {
        skippedCached += 1
        continue
      }
      rows += 1
      maxCredits += config.credits
      maxProviderCostUsd += config.providerCostUsd
      const pc = perColMap.get(config.columnId) ?? { rows: 0, maxCredits: 0 }
      pc.rows += 1
      pc.maxCredits += config.credits
      perColMap.set(config.columnId, pc)
    }

    const perRunCap = wc?.perRunCap ?? Infinity
    const balance = wc?.balance ?? 0
    return {
      rows,
      totalTargeted,
      skippedCached,
      skippedEmptyInput,
      skippedAlreadyFilled,
      maxCredits,
      maxProviderCostUsd: canMargin ? maxProviderCostUsd : null,
      perColumn: [...perColMap.entries()].map(([columnId, v]) => ({ columnId, rows: v.rows, maxCredits: v.maxCredits })),
      blockedByPerRunCap: maxCredits > perRunCap,
      blockedByBudget: maxCredits > balance,
    }
  }

  private buildMeteredRun(table: TableMeta, scope: RunScope, forceFresh: boolean, total: number, triggeredByName: string, runsArray: EnrichmentRun[]): EnrichmentRun {
    const uid = this.store.data.session?.userId ?? ''
    const run: EnrichmentRun = {
      id: newId(),
      workspaceId: table.workspaceId,
      tableId: table.id,
      triggeredBy: uid,
      triggeredByName,
      scope,
      forceFresh,
      status: 'queued',
      counts: { processed: 0, total, success: 0, empty: 0, failed: 0, cached: 0 },
      creditsConsumed: 0,
      providerCostUsd: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    runsArray.push(run)
    return run
  }

  /** Guard a run against the per-run cap + exhausted budget (mirrors ai.run). */
  private assertRunBudget(table: TableMeta, est: EstimateResult): void {
    const wc = this.store.getWorkspaceCredit(table.workspaceId)
    const perRunCap = wc?.perRunCap ?? Infinity
    const balance = wc?.balance ?? 0
    if (balance <= 0 && est.maxCredits > 0) {
      throw new BudgetError('The workspace budget is exhausted — this run is paused', { maxCredits: est.maxCredits, cap: perRunCap })
    }
    if (est.maxCredits > perRunCap) {
      throw new BudgetError(`This run could use up to ${est.maxCredits.toLocaleString('en-US')} credits, above the per-run cap of ${perRunCap.toLocaleString('en-US')}`, { maxCredits: est.maxCredits, cap: perRunCap })
    }
  }

  // ======================================================================
  // Web-research agent columns (Phase 3, US-3.3/3.4)
  // ======================================================================

  private validateAgentConfig(table: TableMeta, input: UpsertAgentConfigInput): {
    model: AgentColumnConfig['model']
    objective: string
    outputSchema: AgentColumnConfig['outputSchema']
    outputMapping: Record<string, string>
    maxSteps: number
    maxPages: number
    credits: number
    providerCostUsd: number
  } {
    const objective = (input.objective ?? '').trim()
    if (!objective) throw new ValidationError('Write a research objective for the agent')
    const modelInfo = resolveAiModel(input.model)
    if (!modelInfo) throw new ValidationError('Choose a valid model')
    const schema = input.outputSchema ?? []
    const mapping = input.outputMapping ?? {}
    const colIds = new Set(this.store.data.columns.filter((c) => c.tableId === table.id).map((c) => c.id))
    const seen = new Set<string>()
    for (const field of schema) {
      const name = field.name?.trim()
      if (!name) throw new ValidationError('Each output field needs a name')
      if (seen.has(name.toLowerCase())) throw new ValidationError(`Duplicate output field “${name}”`)
      seen.add(name.toLowerCase())
      const destId = mapping[field.name]
      if (destId && !colIds.has(destId)) throw new ValidationError(`Field “${name}” maps to a column that isn’t in this table`)
    }
    const maxSteps = Math.max(1, Math.min(20, input.maxSteps ?? 5))
    const maxPages = Math.max(1, Math.min(20, input.maxPages ?? 5))
    // Agent research is pricier than a single LLM call: cost scales with pages.
    const credits = modelInfo.credits * 2
    const providerCostUsd = modelInfo.providerCostUsd * maxPages
    return { model: input.model, objective, outputSchema: schema, outputMapping: mapping, maxSteps, maxPages, credits, providerCostUsd }
  }

  private buildAgentTargets(tableId: string, scope: RunScope): AgentRunTarget[] {
    const cands = this.meteredCandidates(tableId, scope, (t) => this.store.getAgentConfigsForTable(t))
    const targets: AgentRunTarget[] = []
    let order = 0
    for (const { recordId, config } of cands) {
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readAgent(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) continue
      }
      targets.push({ recordId, anchorColumnId: config.columnId, config, orderIndex: order++ })
    }
    return targets
  }

  private computeAgentEstimate(tableId: string, scope: RunScope, forceFresh: boolean, canMargin: boolean): EstimateResult {
    return this.computeMeteredEstimate(
      tableId, scope, forceFresh, canMargin,
      (t) => this.store.getAgentConfigsForTable(t),
      (rid, c) => this.agentEngine.refsPresent(rid, c),
      (meta) => readAgent(meta),
      (rid, c) => this.agentEngine.cacheWarm(rid, c),
    )
  }

  private triggerAgentAutoRun(table: TableMeta, recordIds: string[]): void {
    if (!this.store.data.session) return
    this.agentEngine.autoRun(table.id, recordIds, (targets) => {
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      if (!wc || wc.balance <= 0) return null
      const cols = [...new Set(targets.map((t) => t.anchorColumnId))]
      const est = this.computeAgentEstimate(table.id, { mode: 'selected', recordIds, columnIds: cols }, false, true)
      if (est.maxCredits > wc.perRunCap) return null
      return this.buildMeteredRun(table, { mode: 'selected', recordIds, columnIds: cols }, false, targets.length, 'Auto-run', this.store.data.agentRuns)
    })
  }

  agent: AgentApi = {
    models: {
      list: async (workspaceId: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        return AI_MODELS.map((m) => this.snapAiModel(m, canViewMargin(role)))
      },
    },

    configs: {
      get: async (columnId: string) => {
        await this.delay()
        this.columnScope(columnId)
        const cfg = this.store.getAgentConfig(columnId)
        return cfg ? snap(cfg) : null
      },
      list: async (tableId: string) => {
        await this.delay()
        this.tableScope(tableId)
        return snapList(this.store.getAgentConfigsForTable(tableId))
      },
      upsert: async (input: UpsertAgentConfigInput) => {
        await this.delay()
        const { column, table, role } = this.columnScope(input.columnId)
        this.assertWrite(role)
        const v = this.validateAgentConfig(table, input)
        let cfg = this.store.getAgentConfig(input.columnId)
        if (cfg) {
          cfg.model = v.model
          cfg.objective = v.objective
          cfg.outputSchema = v.outputSchema
          cfg.outputMapping = v.outputMapping
          cfg.maxSteps = v.maxSteps
          cfg.maxPages = v.maxPages
          cfg.credits = v.credits
          cfg.providerCostUsd = v.providerCostUsd
          if (input.cacheTtlDays !== undefined) cfg.cacheTtlDays = input.cacheTtlDays
          if (input.autoRun !== undefined) cfg.autoRun = input.autoRun
          if (input.forceFreshDefault !== undefined) cfg.forceFreshDefault = input.forceFreshDefault
        } else {
          cfg = {
            id: newId(),
            columnId: input.columnId,
            model: v.model,
            objective: v.objective,
            outputSchema: v.outputSchema,
            outputMapping: v.outputMapping,
            maxSteps: v.maxSteps,
            maxPages: v.maxPages,
            cacheTtlDays: input.cacheTtlDays ?? 30,
            autoRun: input.autoRun ?? false,
            forceFreshDefault: input.forceFreshDefault ?? false,
            credits: v.credits,
            providerCostUsd: v.providerCostUsd,
          }
          this.store.data.agentColumnConfigs.push(cfg)
        }
        this.writeAudit(table.workspaceId, 'column.agentConfig', 'agentColumn', input.columnId, { name: column.name, model: v.model.model })
        this.persist()
        return snap(cfg)
      },
      remove: async (columnId: string) => {
        await this.delay()
        const { table, role } = this.columnScope(columnId)
        this.assertWrite(role)
        this.store.data.agentColumnConfigs = this.store.data.agentColumnConfigs.filter((c) => c.columnId !== columnId)
        this.writeAudit(table.workspaceId, 'column.agentConfig', 'agentColumn', columnId, { removed: true })
        this.persist()
      },
    },

    runs: {
      list: async (workspaceId: string, opts) => {
        await this.delay()
        const canMargin = canViewMargin(this.roleFor(workspaceId))
        let runs = this.store.data.agentRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.tableId) runs = runs.filter((r) => r.tableId === opts.tableId)
        runs = runs.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        const offset = opts?.offset ?? 0
        const limit = opts?.limit ?? runs.length
        return runs.slice(offset, offset + limit).map((r) => this.snapAiRun(r, canMargin))
      },
      get: async (runId: string) => {
        await this.delay()
        const run = this.store.data.agentRuns.find((r) => r.id === runId)
        if (!run) throw new NotFoundError('Run not found')
        return this.snapAiRun(run, canViewMargin(this.roleFor(run.workspaceId)))
      },
    },

    estimate: async (tableId: string, scope: RunScope, opts) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      return this.computeAgentEstimate(tableId, scope, opts?.forceFresh ?? false, canViewMargin(role))
    },

    run: async (tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle> => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const forceFresh = opts?.forceFresh ?? false
      const est = this.computeAgentEstimate(tableId, scope, forceFresh, canViewMargin(role))
      this.assertRunBudget(table, est)
      const targets = this.buildAgentTargets(tableId, scope)
      const run = this.buildMeteredRun(table, scope, forceFresh, targets.length, this.user(this.session().userId)?.name ?? 'Someone', this.store.data.agentRuns)
      this.writeAudit(table.workspaceId, 'agent.run', 'agentColumn', run.id, { mode: scope.mode, columns: scope.columnIds.length, rows: targets.length, forceFresh })
      this.persist()
      this.agentEngine.startRun(run, targets)
      return { runId: run.id }
    },

    results: async (recordId: string, columnId: string) => {
      await this.delay()
      const canMargin = canViewMargin(this.columnScope(columnId).role)
      return this.store.data.agentResults
        .filter((r) => r.recordId === recordId && r.columnId === columnId)
        .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : a.fetchedAt > b.fetchedAt ? -1 : 0))
        .map((r) => ({ ...r, sources: r.sources.map((s) => ({ ...s })), providerCostUsd: canMargin ? r.providerCostUsd : 0 }))
    },

    cacheStats: async (workspaceId: string) => {
      await this.delay()
      const canMargin = canViewMargin(this.roleFor(workspaceId))
      const runIds = new Set(this.store.data.agentRuns.filter((r) => r.workspaceId === workspaceId).map((r) => r.id))
      let savedCr = 0
      let savedUsd = 0
      for (const r of this.store.data.agentResults) {
        if (!r.fromCache || !runIds.has(r.runId)) continue
        const cfg = this.store.getAgentConfig(r.columnId)
        if (cfg) {
          savedCr += cfg.credits
          savedUsd += cfg.providerCostUsd
        }
      }
      return { entries: this.store.data.agentCache.length, hitSavingsCredits: savedCr, hitSavingsUsd: canMargin ? savedUsd : null }
    },

    subscribe: (target, cb) => {
      const listener: AgentListener = { runId: target.runId, tableId: target.tableId, cb }
      this.agentListeners.add(listener)
      return () => {
        this.agentListeners.delete(listener)
      }
    },
  }

  // ======================================================================
  // HTTP columns (Phase 3, US-3.5)
  // ======================================================================

  private validateHttpConfig(table: TableMeta, input: UpsertHttpConfigInput): {
    method: HttpColumnConfig['method']
    urlTemplate: string
    headers: HttpColumnConfig['headers']
    bodyTemplate: string
    responsePath: string
    responseMapping: Record<string, string>
    outputMapping: Record<string, string>
    credits: number
    providerCostUsd: number
  } {
    const urlTemplate = (input.urlTemplate ?? '').trim()
    if (!urlTemplate) throw new ValidationError('Enter a request URL')
    if (!/\{\{|^https?:\/\//i.test(urlTemplate)) throw new ValidationError('The URL must start with http(s):// (or a {{Column}} reference)')
    const mapping = input.responseMapping ?? {}
    const outputMapping = input.outputMapping ?? {}
    const colIds = new Set(this.store.data.columns.filter((c) => c.tableId === table.id).map((c) => c.id))
    for (const [field, destId] of Object.entries(outputMapping)) {
      if (destId && !colIds.has(destId)) throw new ValidationError(`Field “${field}” maps to a column that isn’t in this table`)
    }
    // Sanitize headers: a header with a secretRef stores only a masked value.
    const headers = (input.headers ?? []).map((h) => {
      if (h.secretRef) {
        const secret = this.store.getHttpSecret(h.secretRef)
        return { key: h.key, value: secret ? secret.maskedHint : '••••', secretRef: h.secretRef }
      }
      return { key: h.key, value: h.value }
    })
    return {
      method: input.method,
      urlTemplate,
      headers,
      bodyTemplate: input.bodyTemplate ?? '',
      responsePath: (input.responsePath ?? '$').trim() || '$',
      responseMapping: mapping,
      outputMapping,
      credits: 1,
      providerCostUsd: 0.0005,
    }
  }

  private buildHttpTargets(tableId: string, scope: RunScope): HttpRunTarget[] {
    const cands = this.meteredCandidates(tableId, scope, (t) => this.store.getHttpConfigsForTable(t))
    const targets: HttpRunTarget[] = []
    let order = 0
    for (const { recordId, config } of cands) {
      if (scope.mode === 'empty-only') {
        const cell = this.store.getCell(recordId, config.columnId)
        const e = readHttp(cell?.meta)
        if (cell && !isEmptyInput(cell.value) && (!e || e.status !== 'failed')) continue
      }
      targets.push({ recordId, anchorColumnId: config.columnId, config, orderIndex: order++ })
    }
    return targets
  }

  private computeHttpEstimate(tableId: string, scope: RunScope, forceFresh: boolean, canMargin: boolean): EstimateResult {
    return this.computeMeteredEstimate(
      tableId, scope, forceFresh, canMargin,
      (t) => this.store.getHttpConfigsForTable(t),
      (rid, c) => this.httpEngine.refsPresent(rid, c),
      (meta) => readHttp(meta),
      (rid, c) => this.httpEngine.cacheWarm(rid, c),
    )
  }

  private triggerHttpAutoRun(table: TableMeta, recordIds: string[]): void {
    if (!this.store.data.session) return
    this.httpEngine.autoRun(table.id, recordIds, (targets) => {
      const wc = this.store.getWorkspaceCredit(table.workspaceId)
      if (!wc || wc.balance <= 0) return null
      const cols = [...new Set(targets.map((t) => t.anchorColumnId))]
      const est = this.computeHttpEstimate(table.id, { mode: 'selected', recordIds, columnIds: cols }, false, true)
      if (est.maxCredits > wc.perRunCap) return null
      return this.buildMeteredRun(table, { mode: 'selected', recordIds, columnIds: cols }, false, targets.length, 'Auto-run', this.store.data.httpRuns)
    })
  }

  http: HttpApi = {
    secrets: {
      list: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        return snapList(this.store.data.httpSecrets.filter((s) => s.workspaceId === workspaceId))
      },
      create: async (workspaceId: string, input) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertWrite(role)
        const name = (input.name ?? '').trim()
        const token = (input.token ?? '').trim()
        if (!name) throw new ValidationError('Name the secret')
        if (!token) throw new ValidationError('Enter the secret value')
        // The plaintext token is accepted but NEVER stored/echoed (FR-3.5) — only
        // a masked hint of the last 4 chars is kept.
        const secret = {
          id: newId(),
          workspaceId,
          name,
          maskedHint: `••••${token.slice(-4)}`,
          createdAt: new Date().toISOString(),
        }
        this.store.data.httpSecrets.push(secret)
        this.persist()
        return snap(secret)
      },
      remove: async (workspaceId: string, secretId: string) => {
        await this.delay()
        this.assertWrite(this.roleFor(workspaceId))
        this.store.data.httpSecrets = this.store.data.httpSecrets.filter((s) => !(s.id === secretId && s.workspaceId === workspaceId))
        this.persist()
      },
    },

    configs: {
      get: async (columnId: string) => {
        await this.delay()
        this.columnScope(columnId)
        const cfg = this.store.getHttpConfig(columnId)
        return cfg ? snap(cfg) : null
      },
      list: async (tableId: string) => {
        await this.delay()
        this.tableScope(tableId)
        return snapList(this.store.getHttpConfigsForTable(tableId))
      },
      upsert: async (input: UpsertHttpConfigInput) => {
        await this.delay()
        const { column, table, role } = this.columnScope(input.columnId)
        this.assertWrite(role)
        const v = this.validateHttpConfig(table, input)
        let cfg = this.store.getHttpConfig(input.columnId)
        if (cfg) {
          Object.assign(cfg, v)
          if (input.cacheTtlDays !== undefined) cfg.cacheTtlDays = input.cacheTtlDays
          if (input.autoRun !== undefined) cfg.autoRun = input.autoRun
          if (input.forceFreshDefault !== undefined) cfg.forceFreshDefault = input.forceFreshDefault
        } else {
          cfg = {
            id: newId(),
            columnId: input.columnId,
            ...v,
            cacheTtlDays: input.cacheTtlDays ?? 7,
            autoRun: input.autoRun ?? false,
            forceFreshDefault: input.forceFreshDefault ?? false,
          }
          this.store.data.httpColumnConfigs.push(cfg)
        }
        this.writeAudit(table.workspaceId, 'column.httpConfig', 'httpColumn', input.columnId, { name: column.name, method: v.method })
        this.persist()
        return snap(cfg)
      },
      remove: async (columnId: string) => {
        await this.delay()
        const { table, role } = this.columnScope(columnId)
        this.assertWrite(role)
        this.store.data.httpColumnConfigs = this.store.data.httpColumnConfigs.filter((c) => c.columnId !== columnId)
        this.writeAudit(table.workspaceId, 'column.httpConfig', 'httpColumn', columnId, { removed: true })
        this.persist()
      },
    },

    runs: {
      list: async (workspaceId: string, opts) => {
        await this.delay()
        const canMargin = canViewMargin(this.roleFor(workspaceId))
        let runs = this.store.data.httpRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.tableId) runs = runs.filter((r) => r.tableId === opts.tableId)
        runs = runs.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        const offset = opts?.offset ?? 0
        const limit = opts?.limit ?? runs.length
        return runs.slice(offset, offset + limit).map((r) => this.snapAiRun(r, canMargin))
      },
      get: async (runId: string) => {
        await this.delay()
        const run = this.store.data.httpRuns.find((r) => r.id === runId)
        if (!run) throw new NotFoundError('Run not found')
        return this.snapAiRun(run, canViewMargin(this.roleFor(run.workspaceId)))
      },
    },

    estimate: async (tableId: string, scope: RunScope, opts) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      return this.computeHttpEstimate(tableId, scope, opts?.forceFresh ?? false, canViewMargin(role))
    },

    run: async (tableId: string, scope: RunScope, opts?: RunOptions): Promise<RunHandle> => {
      await this.delay()
      const { table, role } = this.tableScope(tableId)
      this.assertWrite(role)
      const forceFresh = opts?.forceFresh ?? false
      const est = this.computeHttpEstimate(tableId, scope, forceFresh, canViewMargin(role))
      this.assertRunBudget(table, est)
      const targets = this.buildHttpTargets(tableId, scope)
      const run = this.buildMeteredRun(table, scope, forceFresh, targets.length, this.user(this.session().userId)?.name ?? 'Someone', this.store.data.httpRuns)
      this.writeAudit(table.workspaceId, 'http.run', 'httpColumn', run.id, { mode: scope.mode, columns: scope.columnIds.length, rows: targets.length, forceFresh })
      this.persist()
      this.httpEngine.startRun(run, targets)
      return { runId: run.id }
    },

    results: async (recordId: string, columnId: string) => {
      await this.delay()
      const canMargin = canViewMargin(this.columnScope(columnId).role)
      return this.store.data.httpResults
        .filter((r) => r.recordId === recordId && r.columnId === columnId)
        .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : a.fetchedAt > b.fetchedAt ? -1 : 0))
        .map((r) => ({ ...r, providerCostUsd: canMargin ? r.providerCostUsd : 0 }))
    },

    cacheStats: async (workspaceId: string) => {
      await this.delay()
      const canMargin = canViewMargin(this.roleFor(workspaceId))
      const runIds = new Set(this.store.data.httpRuns.filter((r) => r.workspaceId === workspaceId).map((r) => r.id))
      let savedCr = 0
      let savedUsd = 0
      for (const r of this.store.data.httpResults) {
        if (!r.fromCache || !runIds.has(r.runId)) continue
        const cfg = this.store.getHttpConfig(r.columnId)
        if (cfg) {
          savedCr += cfg.credits
          savedUsd += cfg.providerCostUsd
        }
      }
      return { entries: this.store.data.httpCache.length, hitSavingsCredits: savedCr, hitSavingsUsd: canMargin ? savedUsd : null }
    },

    subscribe: (target, cb) => {
      const listener: HttpListener = { runId: target.runId, tableId: target.tableId, cb }
      this.httpListeners.add(listener)
      return () => {
        this.httpListeners.delete(listener)
      }
    },
  }

  // ======================================================================
  // Formula columns (Phase 3, US-3.6) — synchronous, no credits.
  // ======================================================================

  private formulaNameToColumn(anchorColumnId: string): Map<string, string> {
    const anchor = this.store.data.columns.find((c) => c.id === anchorColumnId)
    const map = new Map<string, string>()
    for (const c of this.store.data.columns) {
      if (c.tableId === anchor?.tableId) map.set(c.name.trim().toLowerCase(), c.id)
    }
    return map
  }

  /** Compute one formula cell for a record; writes value + meta.formula. */
  private computeFormulaCell(recordId: string, cfg: FormulaColumnConfig): boolean {
    const anchor = this.store.data.columns.find((c) => c.id === cfg.columnId)
    if (!anchor) return false
    const nameToCol = this.formulaNameToColumn(cfg.columnId)
    const res = evaluateFormula(cfg.expression, (name) => {
      const colId = nameToCol.get(name.trim().toLowerCase())
      if (!colId || colId === cfg.columnId) return undefined
      return this.store.getCell(recordId, colId)?.value ?? undefined
    })
    const existing = this.store.getCell(recordId, cfg.columnId)
    const ts = new Date().toISOString()
    if (res.error) {
      this.store.setCell({ recordId, columnId: cfg.columnId, value: existing?.value ?? null, meta: { ...(existing?.meta ?? {}), formula: { status: 'error', error: res.error, computedAt: ts } } })
      return false
    }
    // Coerce through the anchor column type so it sorts/filters/CSVs correctly.
    const v = columnTypeRegistry[anchor.type].validate(res.value, anchor.config)
    const value = v.ok ? v.value : res.value
    this.store.setCell({ recordId, columnId: cfg.columnId, value, meta: { ...(existing?.meta ?? {}), formula: { status: 'ok', computedAt: ts } } })
    return true
  }

  private recomputeFormulaColumn(cfg: FormulaColumnConfig): { computed: number; errors: number } {
    const anchor = this.store.data.columns.find((c) => c.id === cfg.columnId)
    if (!anchor) return { computed: 0, errors: 0 }
    let computed = 0
    let errors = 0
    for (const r of this.store.data.records.filter((r) => r.tableId === anchor.tableId)) {
      if (this.computeFormulaCell(r.id, cfg)) computed += 1
      else errors += 1
    }
    return { computed, errors }
  }

  /** Recompute formula cells in a row, optionally only those referencing a column. */
  private recomputeFormulasForRecord(tableId: string, recordId: string, changedColumnName?: string): void {
    const configs = this.store.getFormulaConfigsForTable(tableId)
    if (configs.length === 0) return
    for (const cfg of configs) {
      if (changedColumnName) {
        const refs = extractFormulaRefs(cfg.expression).map((r) => r.toLowerCase())
        if (!refs.includes(changedColumnName.toLowerCase())) continue
      }
      this.computeFormulaCell(recordId, cfg)
    }
  }

  formula: FormulaApi = {
    get: async (columnId: string) => {
      await this.delay()
      this.columnScope(columnId)
      const cfg = this.store.getFormulaConfig(columnId)
      return cfg ? snap(cfg) : null
    },
    list: async (tableId: string) => {
      await this.delay()
      this.tableScope(tableId)
      return snapList(this.store.getFormulaConfigsForTable(tableId))
    },
    upsert: async (input: UpsertFormulaConfigInput) => {
      await this.delay()
      const { column, table, role } = this.columnScope(input.columnId)
      this.assertWrite(role)
      const expression = (input.expression ?? '').trim()
      if (!expression) throw new ValidationError('Enter a formula expression')
      const err = validateFormula(expression)
      if (err) throw new ValidationError(`Invalid formula: ${err}`)
      let cfg = this.store.getFormulaConfig(input.columnId)
      if (cfg) {
        cfg.expression = expression
      } else {
        cfg = { id: newId(), columnId: input.columnId, expression }
        this.store.data.formulaColumnConfigs.push(cfg)
      }
      this.writeAudit(table.workspaceId, 'column.formulaConfig', 'formulaColumn', input.columnId, { name: column.name })
      // Compute immediately so the column fills the moment it's configured.
      this.recomputeFormulaColumn(cfg)
      this.persist()
      return snap(cfg)
    },
    remove: async (columnId: string) => {
      await this.delay()
      const { table, role } = this.columnScope(columnId)
      this.assertWrite(role)
      this.store.data.formulaColumnConfigs = this.store.data.formulaColumnConfigs.filter((c) => c.columnId !== columnId)
      this.writeAudit(table.workspaceId, 'column.formulaConfig', 'formulaColumn', columnId, { removed: true })
      this.persist()
    },
    validate: async (expression: string) => {
      await this.delay()
      return { error: validateFormula((expression ?? '').trim()) }
    },
    recomputeTable: async (tableId: string) => {
      await this.delay()
      const { role } = this.tableScope(tableId)
      this.assertWrite(role)
      let computed = 0
      let errors = 0
      for (const cfg of this.store.getFormulaConfigsForTable(tableId)) {
        const r = this.recomputeFormulaColumn(cfg)
        computed += r.computed
        errors += r.errors
      }
      this.persist()
      return { computed, errors }
    },
  }

  // ======================================================================
  // Automation layer (Phase 3, US-3.7–3.10)
  // ======================================================================

  /** Log a row into the unified integration event feed (US-3.15). */
  private logIntegrationEvent(
    workspaceId: string,
    source: IntegrationEventSource,
    status: IntegrationEventStatus,
    summary: string,
    detail: Record<string, unknown>,
    tableId?: string,
    refId?: string,
  ): IntegrationEvent {
    const ev: IntegrationEvent = {
      id: newId(),
      workspaceId,
      source,
      status,
      summary,
      detail,
      tableId,
      refId,
      createdAt: new Date().toISOString(),
    }
    this.store.data.integrationEvents.push(ev)
    return ev
  }

  private assertManageAutomations(role: Role): void {
    if (!canManageAutomations(role)) throw new ForbiddenError('Only owners and admins can manage automations')
  }
  private assertManageIntegrations(role: Role): void {
    if (!canManageIntegrations(role)) throw new ForbiddenError('Only owners and admins can manage integrations')
  }

  private nextRunFor(schedule: Automation['schedule'], from = Date.now()): string {
    const s = schedule
    if (!s) return new Date(from + 3600_000).toISOString()
    if (s.cadence === 'hourly') return new Date(from + 3600_000).toISOString()
    if (s.cadence === 'daily') return new Date(from + 86400_000).toISOString()
    return new Date(from + 7 * 86400_000).toISOString()
  }

  /** Kick off a run for one column via the engine that owns its kind. */
  private startColumnRun(table: TableMeta, columnId: string, forceFresh: boolean): { affected: number; kind: string } {
    const scope: RunScope = { mode: 'whole', columnIds: [columnId] }
    if (this.store.getFormulaConfig(columnId)) {
      const cfg = this.store.getFormulaConfig(columnId)!
      const r = this.recomputeFormulaColumn(cfg)
      return { affected: r.computed + r.errors, kind: 'formula' }
    }
    if (this.store.getAgentConfig(columnId)) {
      const targets = this.buildAgentTargets(table.id, scope)
      const run = this.buildMeteredRun(table, scope, forceFresh, targets.length, 'Automation', this.store.data.agentRuns)
      this.agentEngine.startRun(run, targets)
      return { affected: targets.length, kind: 'agent' }
    }
    if (this.store.getHttpConfig(columnId)) {
      const targets = this.buildHttpTargets(table.id, scope)
      const run = this.buildMeteredRun(table, scope, forceFresh, targets.length, 'Automation', this.store.data.httpRuns)
      this.httpEngine.startRun(run, targets)
      return { affected: targets.length, kind: 'http' }
    }
    if (this.store.getAiConfig(columnId)) {
      const targets = this.buildAiTargets(table.id, scope)
      const run = this.buildAiRun(table, scope, forceFresh, targets.length, 'Automation')
      this.aiEngine.startRun(run, targets)
      return { affected: targets.length, kind: 'ai' }
    }
    // Enrichment column.
    const targets = this.buildTargets(table.id, scope)
    const run = this.buildRun(table, scope, forceFresh, targets.length, 'Automation')
    this.engine.startRun(run, targets)
    return { affected: targets.length, kind: 'enrichment' }
  }

  /** Execute an automation now, recording a run + an integration event. */
  private executeAutomation(automation: Automation, trigger: Automation['trigger']): AutomationRun {
    const table = this.store.data.tables.find((t) => t.id === automation.tableId)
    const startedAt = new Date().toISOString()
    let status: AutomationRunStatus = 'success'
    let affected = 0
    let detail = ''
    try {
      if (!table) {
        status = 'skipped'
        detail = 'target table no longer exists'
      } else if (automation.action === 'run_column' && automation.targetColumnId) {
        const r = this.startColumnRun(table, automation.targetColumnId, automation.forceFresh)
        affected = r.affected
        detail = affected > 0 ? `Queued ${affected} ${r.kind} cell${affected === 1 ? '' : 's'}` : 'Nothing to run'
        if (affected === 0) status = 'skipped'
      } else if (automation.action === 'run_table') {
        const cols = this.runnableColumnIds(table.id)
        for (const colId of cols) affected += this.startColumnRun(table, colId, automation.forceFresh).affected
        detail = affected > 0 ? `Queued ${affected} cells across ${cols.length} columns` : 'Nothing to run'
        if (affected === 0) status = 'skipped'
      } else {
        status = 'skipped'
        detail = 'no target column configured'
      }
    } catch (e) {
      status = 'failed'
      detail = e instanceof Error ? e.message : 'automation failed'
    }
    const finishedAt = new Date().toISOString()
    const runRow: AutomationRun = {
      id: newId(),
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      trigger,
      status,
      affected,
      detail,
      startedAt,
      finishedAt,
    }
    this.store.data.automationRuns.push(runRow)
    automation.lastRunAt = finishedAt
    automation.lastStatus = status
    if (automation.trigger === 'schedule') automation.nextRunAt = this.nextRunFor(automation.schedule)
    this.logIntegrationEvent(automation.workspaceId, automation.trigger === 'schedule' ? 'schedule' : 'row_event', status, `${automation.name}: ${detail}`, { automationId: automation.id, trigger }, automation.tableId, automation.id)
    return runRow
  }

  /** All columns in a table that have an executable config (any operation kind). */
  private runnableColumnIds(tableId: string): string[] {
    const out: string[] = []
    for (const c of this.store.data.columns.filter((c) => c.tableId === tableId)) {
      if (
        this.store.getConfig(c.id) ||
        this.store.getAiConfig(c.id) ||
        this.store.getAgentConfig(c.id) ||
        this.store.getHttpConfig(c.id)
      ) {
        out.push(c.id)
      }
    }
    return out
  }

  /** Fire row-event automations + outbound webhooks for a record change. */
  private fireRowEvent(table: TableMeta, recordId: string, event: RowEvent, changedColumnId?: string): void {
    // Row-event automations (US-3.8).
    for (const a of this.store.getAutomationsForWorkspace(table.workspaceId)) {
      if (!a.isEnabled || a.trigger !== 'row_event' || a.tableId !== table.id) continue
      if (a.rowEvent?.event !== event) continue
      if (event === 'record.updated' && a.rowEvent?.watchColumnId && a.rowEvent.watchColumnId !== changedColumnId) continue
      this.executeAutomation(a, 'row_event')
    }
    // Outbound webhooks (US-3.10).
    for (const w of this.store.data.outboundWebhooks) {
      if (!w.isEnabled || w.workspaceId !== table.workspaceId || w.tableId !== table.id || w.event !== event) continue
      if (!this.outboundConditionMet(w, recordId, changedColumnId)) continue
      this.deliverOutbound(w, table, recordId, event)
    }
  }

  private outboundConditionMet(w: OutboundWebhook, recordId: string, changedColumnId?: string): boolean {
    const c = w.condition
    if (!c) return true
    if (c.op === 'changed') return c.columnId === changedColumnId
    const val = this.store.getCell(recordId, c.columnId)?.value ?? null
    if (c.op === 'notEmpty') return !isEmptyInput(val)
    if (c.op === 'equals') return String(val ?? '') === String(c.value ?? '')
    return true
  }

  private deliverOutbound(w: OutboundWebhook, table: TableMeta, recordId: string, event: RowEvent): void {
    // Deterministic mock delivery: ~92% succeed.
    const roll = (newId().charCodeAt(0) + recordId.length) % 100
    const ok = roll >= 8
    w.lastDeliveryAt = new Date().toISOString()
    if (ok) {
      w.deliveredCount += 1
      w.lastStatus = 'delivered'
    } else {
      w.failedCount += 1
      w.lastStatus = 'failed'
    }
    this.logIntegrationEvent(
      table.workspaceId,
      'webhook_out',
      ok ? 'success' : 'failed',
      `${w.name} → POST ${w.url} (${event})${ok ? '' : ' — failed, will retry'}`,
      { webhookId: w.id, recordId, event, url: w.url },
      table.id,
      recordId,
    )
  }

  automation: AutomationApi = {
    automations: {
      list: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        return snapList(this.store.getAutomationsForWorkspace(workspaceId)).sort(byCreatedDesc)
      },
      upsert: async (workspaceId: string, input: UpsertAutomationInput) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageAutomations(role)
        const table = this.store.data.tables.find((t) => t.id === input.tableId && t.workspaceId === workspaceId)
        if (!table) throw new NotFoundError('Table not found')
        const name = (input.name ?? '').trim()
        if (!name) throw new ValidationError('Name the automation')
        if (input.action === 'run_column' && !input.targetColumnId) throw new ValidationError('Choose a column to run')
        let a = input.id ? this.store.getAutomation(input.id) : undefined
        if (a && a.workspaceId !== workspaceId) throw new NotFoundError()
        const schedule = input.trigger === 'schedule' ? (input.schedule ?? { cadence: 'daily' as const }) : undefined
        if (a) {
          a.name = name
          a.tableId = input.tableId
          a.trigger = input.trigger
          a.action = input.action
          a.targetColumnId = input.targetColumnId
          a.forceFresh = input.forceFresh ?? a.forceFresh
          a.schedule = schedule
          a.rowEvent = input.trigger === 'row_event' ? (input.rowEvent ?? { event: 'record.created' }) : undefined
          if (input.isEnabled !== undefined) a.isEnabled = input.isEnabled
          a.nextRunAt = input.trigger === 'schedule' ? this.nextRunFor(schedule) : null
          this.writeAudit(workspaceId, 'automation.update', 'automation', a.id, { name })
        } else {
          a = {
            id: newId(),
            workspaceId,
            tableId: input.tableId,
            name,
            trigger: input.trigger,
            action: input.action,
            targetColumnId: input.targetColumnId,
            forceFresh: input.forceFresh ?? false,
            schedule,
            rowEvent: input.trigger === 'row_event' ? (input.rowEvent ?? { event: 'record.created' }) : undefined,
            isEnabled: input.isEnabled ?? true,
            createdBy: this.session().userId,
            createdAt: new Date().toISOString(),
            nextRunAt: input.trigger === 'schedule' ? this.nextRunFor(schedule) : null,
            lastRunAt: null,
            lastStatus: null,
          }
          this.store.data.automations.push(a)
          this.writeAudit(workspaceId, 'automation.create', 'automation', a.id, { name, trigger: input.trigger })
        }
        this.persist()
        return snap(a)
      },
      setEnabled: async (workspaceId: string, id: string, enabled: boolean) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const a = this.store.getAutomation(id)
        if (!a || a.workspaceId !== workspaceId) throw new NotFoundError()
        a.isEnabled = enabled
        this.writeAudit(workspaceId, 'automation.update', 'automation', id, { enabled })
        this.persist()
        return snap(a)
      },
      remove: async (workspaceId: string, id: string) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const a = this.store.getAutomation(id)
        if (!a || a.workspaceId !== workspaceId) throw new NotFoundError()
        this.store.data.automations = this.store.data.automations.filter((x) => x.id !== id)
        this.writeAudit(workspaceId, 'automation.remove', 'automation', id, { name: a.name })
        this.persist()
      },
      runNow: async (workspaceId: string, id: string) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageAutomations(role)
        this.assertWrite(role)
        const a = this.store.getAutomation(id)
        if (!a || a.workspaceId !== workspaceId) throw new NotFoundError()
        this.writeAudit(workspaceId, 'automation.run', 'automation', id, { name: a.name })
        const run = this.executeAutomation(a, a.trigger)
        this.persist()
        return snap(run)
      },
      runs: async (workspaceId: string, opts) => {
        await this.delay()
        this.roleFor(workspaceId)
        let runs = this.store.data.automationRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.automationId) runs = runs.filter((r) => r.automationId === opts.automationId)
        runs = runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        return snapList(runs.slice(0, opts?.limit ?? runs.length))
      },
    },

    webhooks: {
      listInbound: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        return snapList(this.store.data.inboundWebhooks.filter((w) => w.workspaceId === workspaceId)).sort(byCreatedDesc)
      },
      createInbound: async (workspaceId: string, input: UpsertInboundWebhookInput) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const table = this.store.data.tables.find((t) => t.id === input.tableId && t.workspaceId === workspaceId)
        if (!table) throw new NotFoundError('Table not found')
        const name = (input.name ?? '').trim()
        if (!name) throw new ValidationError('Name the webhook')
        const slug = `${slugify(name)}-${newId().slice(0, 6)}`
        const secret = `whsec_${newId()}${newId()}`.replace(/-/g, '').slice(0, 32)
        const webhook: InboundWebhook = {
          id: newId(),
          workspaceId,
          tableId: input.tableId,
          name,
          slug,
          secretHint: `••••${secret.slice(-4)}`,
          mapping: input.mapping ?? {},
          isEnabled: input.isEnabled ?? true,
          createdAt: new Date().toISOString(),
          lastReceivedAt: null,
          receivedCount: 0,
        }
        this.store.data.inboundWebhooks.push(webhook)
        this.writeAudit(workspaceId, 'webhook.inbound.create', 'webhook', webhook.id, { name })
        this.persist()
        // The full URL + secret are shown ONCE; the store keeps only the hint.
        const created: InboundWebhookCreated = { webhook: snap(webhook), url: `https://hooks.cascade.app/in/${slug}`, secret }
        return created
      },
      setInboundEnabled: async (workspaceId: string, id: string, enabled: boolean) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const w = this.store.data.inboundWebhooks.find((x) => x.id === id && x.workspaceId === workspaceId)
        if (!w) throw new NotFoundError()
        w.isEnabled = enabled
        this.persist()
        return snap(w)
      },
      removeInbound: async (workspaceId: string, id: string) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const w = this.store.data.inboundWebhooks.find((x) => x.id === id && x.workspaceId === workspaceId)
        if (!w) throw new NotFoundError()
        this.store.data.inboundWebhooks = this.store.data.inboundWebhooks.filter((x) => x.id !== id)
        this.writeAudit(workspaceId, 'webhook.inbound.remove', 'webhook', id, { name: w.name })
        this.persist()
      },
      simulateInbound: async (slug: string, secret: string, payload: Record<string, unknown>) => {
        await this.delay()
        const w = this.store.getInboundWebhookBySlug(slug)
        if (!w || !w.isEnabled) return { ok: false, reason: 'unknown or disabled endpoint' }
        // Authenticate by the secret's last 4 (the full secret is only known to
        // the caller who created it; the mock verifies the hint).
        if (!secret || `••••${secret.slice(-4)}` !== w.secretHint) return { ok: false, reason: 'invalid secret' }
        const table = this.store.data.tables.find((t) => t.id === w.tableId)
        if (!table) return { ok: false, reason: 'table not found' }
        const columns = this.columnsForTable(w.tableId)
        // Map incoming JSON fields → columns.
        const cells: Cell[] = []
        const position = this.store.data.records.filter((r) => r.tableId === w.tableId).length
        const record: RecordRow = { id: newId(), tableId: w.tableId, position, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        for (const [field, destId] of Object.entries(w.mapping)) {
          const col = columns.find((c) => c.id === destId)
          if (!col) continue
          const raw = payload[field]
          if (raw == null) continue
          const v = columnTypeRegistry[col.type].validate(raw, col.config)
          cells.push({ recordId: record.id, columnId: destId, value: v.ok ? v.value : String(raw), meta: {} })
        }
        this.store.data.records.push(record)
        this.store.addCells(cells)
        w.receivedCount += 1
        w.lastReceivedAt = new Date().toISOString()
        this.logIntegrationEvent(w.workspaceId, 'webhook_in', 'success', `${w.name}: created a row from inbound payload`, { webhookId: w.id, fields: Object.keys(w.mapping).length }, w.tableId, record.id)
        // New row → downstream auto-runs + formulas + row-event fires.
        this.afterRecordsAdded(table, [record.id])
        this.persist()
        return { ok: true, recordId: record.id }
      },

      listOutbound: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        return snapList(this.store.data.outboundWebhooks.filter((w) => w.workspaceId === workspaceId)).sort(byCreatedDesc)
      },
      createOutbound: async (workspaceId: string, input: UpsertOutboundWebhookInput) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const table = this.store.data.tables.find((t) => t.id === input.tableId && t.workspaceId === workspaceId)
        if (!table) throw new NotFoundError('Table not found')
        const name = (input.name ?? '').trim()
        const url = (input.url ?? '').trim()
        if (!name) throw new ValidationError('Name the webhook')
        if (!/^https?:\/\//i.test(url)) throw new ValidationError('Enter a valid https:// URL')
        const existingId = input.id
        let w = existingId ? this.store.data.outboundWebhooks.find((x) => x.id === existingId) : undefined
        if (w && w.workspaceId !== workspaceId) throw new NotFoundError()
        if (w) {
          Object.assign(w, { name, url, event: input.event, condition: input.condition, fieldColumnIds: input.fieldColumnIds ?? [], tableId: input.tableId })
          if (input.isEnabled !== undefined) w.isEnabled = input.isEnabled
        } else {
          w = {
            id: newId(),
            workspaceId,
            tableId: input.tableId,
            name,
            url,
            event: input.event,
            condition: input.condition,
            fieldColumnIds: input.fieldColumnIds ?? [],
            isEnabled: input.isEnabled ?? true,
            createdAt: new Date().toISOString(),
            lastDeliveryAt: null,
            lastStatus: null,
            deliveredCount: 0,
            failedCount: 0,
          }
          this.store.data.outboundWebhooks.push(w)
        }
        this.writeAudit(workspaceId, 'webhook.outbound.create', 'webhook', w.id, { name })
        this.persist()
        return snap(w)
      },
      setOutboundEnabled: async (workspaceId: string, id: string, enabled: boolean) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const w = this.store.data.outboundWebhooks.find((x) => x.id === id && x.workspaceId === workspaceId)
        if (!w) throw new NotFoundError()
        w.isEnabled = enabled
        this.persist()
        return snap(w)
      },
      removeOutbound: async (workspaceId: string, id: string) => {
        await this.delay()
        this.assertManageAutomations(this.roleFor(workspaceId))
        const w = this.store.data.outboundWebhooks.find((x) => x.id === id && x.workspaceId === workspaceId)
        if (!w) throw new NotFoundError()
        this.store.data.outboundWebhooks = this.store.data.outboundWebhooks.filter((x) => x.id !== id)
        this.writeAudit(workspaceId, 'webhook.outbound.remove', 'webhook', id, { name: w.name })
        this.persist()
      },
    },
  }

  // ======================================================================
  // Integration layer (Phase 3, US-3.12–3.15) — CRM, Slack, event history.
  // ======================================================================

  private snapCrm(c: CrmConnection): CrmConnection {
    return { ...c, fieldMapping: { ...c.fieldMapping } }
  }

  integration: IntegrationApi = {
    crm: {
      list: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        return this.store.data.crmConnections.filter((c) => c.workspaceId === workspaceId).map((c) => this.snapCrm(c))
      },
      connect: async (workspaceId: string, input: ConnectCrmInput) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const token = (input.token ?? '').trim()
        if (!token) throw new ValidationError('Enter the API token')
        const table = this.store.data.tables.find((t) => t.id === input.tableId && t.workspaceId === workspaceId)
        if (!table) throw new NotFoundError('Table not found')
        const conn: CrmConnection = {
          id: newId(),
          workspaceId,
          provider: input.provider,
          accountLabel: (input.accountLabel ?? '').trim() || input.provider,
          maskedToken: `••••${token.slice(-4)}`,
          tableId: input.tableId,
          fieldMapping: input.fieldMapping ?? {},
          dedupeColumnId: input.dedupeColumnId,
          isConnected: true,
          createdAt: new Date().toISOString(),
          lastSyncAt: null,
        }
        this.store.data.crmConnections.push(conn)
        this.writeAudit(workspaceId, 'integration.connect', 'integration', conn.id, { provider: input.provider })
        this.logIntegrationEvent(workspaceId, 'crm', 'success', `Connected ${crmLabel(input.provider)}`, { provider: input.provider })
        this.persist()
        return this.snapCrm(conn)
      },
      updateMapping: async (workspaceId: string, id: string, patch) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const conn = this.store.getCrmConnection(id)
        if (!conn || conn.workspaceId !== workspaceId) throw new NotFoundError()
        if (patch.fieldMapping) conn.fieldMapping = patch.fieldMapping
        if (patch.dedupeColumnId !== undefined) conn.dedupeColumnId = patch.dedupeColumnId
        this.persist()
        return this.snapCrm(conn)
      },
      disconnect: async (workspaceId: string, id: string) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const conn = this.store.getCrmConnection(id)
        if (!conn || conn.workspaceId !== workspaceId) throw new NotFoundError()
        this.store.data.crmConnections = this.store.data.crmConnections.filter((c) => c.id !== id)
        this.writeAudit(workspaceId, 'integration.disconnect', 'integration', id, { provider: conn.provider })
        this.logIntegrationEvent(workspaceId, 'crm', 'success', `Disconnected ${crmLabel(conn.provider)}`, { provider: conn.provider })
        this.persist()
      },
      sync: async (workspaceId: string, id: string, direction: CrmSyncDirection) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const conn = this.store.getCrmConnection(id)
        if (!conn || conn.workspaceId !== workspaceId) throw new NotFoundError()
        const run = this.runCrmSync(conn, direction)
        this.persist()
        return snap(run)
      },
      syncRuns: async (workspaceId: string, opts) => {
        await this.delay()
        this.roleFor(workspaceId)
        let runs = this.store.data.crmSyncRuns.filter((r) => r.workspaceId === workspaceId)
        if (opts?.connectionId) runs = runs.filter((r) => r.connectionId === opts.connectionId)
        runs = runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
        return snapList(runs.slice(0, opts?.limit ?? runs.length))
      },
    },

    slack: {
      get: async (workspaceId: string) => {
        await this.delay()
        this.roleFor(workspaceId)
        const s = this.store.getSlackConnection(workspaceId)
        return s ? snap(s) : null
      },
      connect: async (workspaceId: string, input: ConnectSlackInput) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const token = (input.token ?? '').trim()
        if (!token) throw new ValidationError('Enter the Slack token')
        const channel = (input.defaultChannel ?? '').trim() || '#general'
        this.store.data.slackConnections = this.store.data.slackConnections.filter((s) => s.workspaceId !== workspaceId)
        const conn: SlackConnection = {
          id: newId(),
          workspaceId,
          teamName: (input.teamName ?? '').trim() || 'Slack workspace',
          maskedToken: `••••${token.slice(-4)}`,
          defaultChannel: channel.startsWith('#') ? channel : `#${channel}`,
          isConnected: true,
          createdAt: new Date().toISOString(),
        }
        this.store.data.slackConnections.push(conn)
        this.writeAudit(workspaceId, 'integration.connect', 'integration', conn.id, { provider: 'slack' })
        this.logIntegrationEvent(workspaceId, 'slack', 'success', `Connected Slack (${conn.teamName})`, { channel: conn.defaultChannel })
        this.persist()
        return snap(conn)
      },
      disconnect: async (workspaceId: string) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const conn = this.store.getSlackConnection(workspaceId)
        this.store.data.slackConnections = this.store.data.slackConnections.filter((s) => s.workspaceId !== workspaceId)
        if (conn) {
          this.writeAudit(workspaceId, 'integration.disconnect', 'integration', conn.id, { provider: 'slack' })
          this.logIntegrationEvent(workspaceId, 'slack', 'success', 'Disconnected Slack', {})
        }
        this.persist()
      },
      notify: async (workspaceId: string, input) => {
        await this.delay()
        this.assertManageIntegrations(this.roleFor(workspaceId))
        const conn = this.store.getSlackConnection(workspaceId)
        if (!conn) throw new ValidationError('Connect Slack first')
        const channel = (input.channel ?? conn.defaultChannel).trim()
        const text = (input.text ?? '').trim()
        if (!text) throw new ValidationError('Enter a message')
        this.writeAudit(workspaceId, 'slack.notify', 'integration', conn.id, { channel })
        this.logIntegrationEvent(workspaceId, 'slack', 'success', `Slack → ${channel}: ${text.slice(0, 80)}`, { channel })
        this.persist()
        return { ok: true }
      },
    },

    events: async (workspaceId: string, opts) => {
      await this.delay()
      this.roleFor(workspaceId)
      let events = this.store.data.integrationEvents.filter((e) => e.workspaceId === workspaceId)
      if (opts?.source) events = events.filter((e) => e.source === opts.source)
      events = events.sort(byCreatedDesc)
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? events.length
      return snapList(events.slice(offset, offset + limit))
    },
  }

  /** Deterministic mock CRM sync producing believable created/updated/skip counts. */
  private runCrmSync(conn: CrmConnection, direction: CrmSyncDirection): CrmSyncRun {
    const startedAt = new Date().toISOString()
    const table = this.store.data.tables.find((t) => t.id === conn.tableId)
    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0

    if (table) {
      if (direction === 'push') {
        const records = this.store.data.records.filter((r) => r.tableId === conn.tableId)
        const seenKeys = new Set<string>()
        for (const r of records) {
          const key = conn.dedupeColumnId ? String(this.store.getCell(r.id, conn.dedupeColumnId)?.value ?? '') : r.id
          if (conn.dedupeColumnId && !key) {
            skipped += 1 // no dedupe key → can't push safely
            continue
          }
          if (seenKeys.has(key)) {
            skipped += 1 // duplicate within the batch (US-3.12 dedupe)
            continue
          }
          seenKeys.add(key)
          // Deterministic: ~35% already exist in the CRM → update, else create.
          if ((hashStr(key) % 100) < 35) updated += 1
          else created += 1
        }
      } else {
        // Pull: synthesize a deterministic number of inbound CRM records.
        const n = 4 + (hashStr(conn.id) % 6)
        const columns = this.columnsForTable(conn.tableId)
        const existingKeys = new Set(
          conn.dedupeColumnId
            ? this.store.data.records.filter((r) => r.tableId === conn.tableId).map((r) => String(this.store.getCell(r.id, conn.dedupeColumnId!)?.value ?? ''))
            : [],
        )
        for (let i = 0; i < n; i++) {
          const key = `crm-${conn.provider}-${hashStr(conn.id + i)}`
          if (conn.dedupeColumnId && existingKeys.has(key)) {
            updated += 1
            continue
          }
          // Create a new row mapped from CRM fields.
          const position = this.store.data.records.filter((r) => r.tableId === conn.tableId).length
          const record: RecordRow = { id: newId(), tableId: conn.tableId, position, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          const cells: Cell[] = []
          for (const [crmField, destId] of Object.entries(conn.fieldMapping)) {
            const col = columns.find((c) => c.id === destId)
            if (!col) continue
            const raw = mockCrmValue(crmField, conn.id + i)
            const v = columnTypeRegistry[col.type].validate(raw, col.config)
            cells.push({ recordId: record.id, columnId: destId, value: v.ok ? v.value : String(raw), meta: {} })
          }
          this.store.data.records.push(record)
          this.store.addCells(cells)
          created += 1
        }
      }
    } else {
      failed = 1
    }

    const run: CrmSyncRun = {
      id: newId(),
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      provider: conn.provider,
      direction,
      created,
      updated,
      skipped,
      failed,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    this.store.data.crmSyncRuns.push(run)
    conn.lastSyncAt = run.finishedAt
    const status: IntegrationEventStatus = failed > 0 ? 'failed' : 'success'
    this.writeAudit(conn.workspaceId, 'crm.sync', 'integration', conn.id, { direction, created, updated, skipped })
    this.logIntegrationEvent(
      conn.workspaceId,
      'crm',
      status,
      `${crmLabel(conn.provider)} ${direction}: ${created} created, ${updated} updated, ${skipped} skipped`,
      { direction, created, updated, skipped, failed },
      conn.tableId,
      conn.id,
    )
    return run
  }

  // ======================================================================
  // credits
  // ======================================================================

  private resultsForWorkspace(workspaceId: string, since?: string): Array<{ providerId: string | null; columnId: string; tableId: string; credits: number; providerCostUsd: number }> {
    const runById = new Map(this.store.data.enrichmentRuns.filter((r) => r.workspaceId === workspaceId).map((r) => [r.id, r] as const))
    const out: Array<{ providerId: string | null; columnId: string; tableId: string; credits: number; providerCostUsd: number }> = []
    for (const r of this.store.data.enrichmentResults) {
      const run = runById.get(r.runId)
      if (!run) continue
      if (since && r.fetchedAt < since) continue
      out.push({ providerId: r.providerId, columnId: r.columnId, tableId: run.tableId, credits: r.credits, providerCostUsd: r.providerCostUsd })
    }
    return out
  }

  /** By-provider consumption from the append-only ledger (`enrich:<key>:<op>`). */
  private ledgerConsumptionByProvider(workspaceId: string, canMargin: boolean, since?: string): ConsumptionBucket[] {
    const byKey = new Map(this.store.data.providers.map((p) => [p.key, p] as const))
    const map = new Map<string, { label: string; credits: number; usd: number }>()
    for (const e of this.store.data.creditLedger) {
      if (e.workspaceId !== workspaceId || e.delta >= 0) continue
      if (since && e.createdAt < since) continue
      const m = /^enrich:([^:]+):(.+)$/.exec(e.reason)
      if (!m || !m[1] || !m[2]) continue
      const provider = byKey.get(m[1])
      if (!provider) continue
      const credits = -e.delta
      const cost = provider.costConfig[m[2] as EnrichmentOperation]
      const usd = cost && cost.credits > 0 ? credits * (cost.providerCostUsd / cost.credits) : 0
      const b = map.get(provider.id) ?? { label: provider.name, credits: 0, usd: 0 }
      b.credits += credits
      b.usd += usd
      map.set(provider.id, b)
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, credits: v.credits, providerCostUsd: canMargin ? Math.round(v.usd * 100) / 100 : null }))
      .sort((a, b) => b.credits - a.credits)
  }

  /** By-model AI consumption from the ledger (`ai:<modelKey>:<op>` reasons). */
  private ledgerConsumptionByModel(workspaceId: string, canMargin: boolean, since?: string): ConsumptionBucket[] {
    const map = new Map<string, { label: string; credits: number; usd: number }>()
    for (const e of this.store.data.creditLedger) {
      if (e.workspaceId !== workspaceId || e.delta >= 0) continue
      if (since && e.createdAt < since) continue
      const m = /^ai:([^:]+):(.+)$/.exec(e.reason)
      if (!m || !m[1]) continue
      const model = aiModelByKey(m[1])
      if (!model) continue
      const credits = -e.delta
      const usd = model.credits > 0 ? credits * (model.providerCostUsd / model.credits) : 0
      const b = map.get(model.key) ?? { label: model.label, credits: 0, usd: 0 }
      b.credits += credits
      b.usd += usd
      map.set(model.key, b)
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, credits: v.credits, providerCostUsd: canMargin ? Math.round(v.usd * 100) / 100 : null }))
      .sort((a, b) => b.credits - a.credits)
  }

  private consumption(
    workspaceId: string,
    canMargin: boolean,
    since: string | undefined,
    keyFor: (r: { providerId: string | null; columnId: string; tableId: string }) => { key: string; label: string } | null,
  ): ConsumptionBucket[] {
    const map = new Map<string, { label: string; credits: number; usd: number }>()
    for (const r of this.resultsForWorkspace(workspaceId, since)) {
      if (r.credits <= 0) continue
      const k = keyFor(r)
      if (!k) continue
      const b = map.get(k.key) ?? { label: k.label, credits: 0, usd: 0 }
      b.credits += r.credits
      b.usd += r.providerCostUsd
      map.set(k.key, b)
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, credits: v.credits, providerCostUsd: canMargin ? v.usd : null }))
      .sort((a, b) => b.credits - a.credits)
  }

  credits: CreditsApi = {
    balance: async (workspaceId: string): Promise<BalanceInfo> => {
      await this.delay()
      this.roleFor(workspaceId)
      const wc = this.store.getWorkspaceCredit(workspaceId)
      const balance = wc?.balance ?? 0
      return { balance, budgetCap: wc?.budgetCap ?? 0, perRunCap: wc?.perRunCap ?? 0, paused: balance <= 0 }
    },

    budget: {
      get: async (workspaceId: string): Promise<BudgetSettings> => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageBilling(role)
        const wc = this.store.getWorkspaceCredit(workspaceId)
        return { balance: wc?.balance ?? 0, budgetCap: wc?.budgetCap ?? 0, perRunCap: wc?.perRunCap ?? 0 }
      },
      set: async (workspaceId: string, patch) => {
        await this.delay()
        const role = this.roleFor(workspaceId)
        this.assertManageBilling(role)
        let wc = this.store.getWorkspaceCredit(workspaceId)
        if (!wc) {
          wc = { workspaceId, balance: 0, budgetCap: 0, perRunCap: 0 }
          this.store.data.workspaceCredits.push(wc)
        }
        if (patch.budgetCap !== undefined) {
          if (patch.budgetCap < 0) throw new ValidationError('Budget cannot be negative')
          wc.budgetCap = Math.round(patch.budgetCap)
        }
        if (patch.perRunCap !== undefined) {
          if (patch.perRunCap < 0) throw new ValidationError('Per-run cap cannot be negative')
          wc.perRunCap = Math.round(patch.perRunCap)
        }
        this.writeAudit(workspaceId, 'budget.update', 'workspace', workspaceId, { budgetCap: wc.budgetCap, perRunCap: wc.perRunCap })
        this.persist()
        return { balance: wc.balance, budgetCap: wc.budgetCap, perRunCap: wc.perRunCap }
      },
    },

    ledger: async (workspaceId: string, opts) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      this.assertManageBilling(role)
      let entries = this.store.data.creditLedger.filter((e) => e.workspaceId === workspaceId)
      if (opts?.runId) entries = entries.filter((e) => e.runId === opts.runId)
      entries = entries.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? entries.length
      return snapList(entries.slice(offset, offset + limit))
    },

    consumptionByProvider: async (workspaceId: string, opts) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      return this.ledgerConsumptionByProvider(workspaceId, canViewMargin(role), opts?.since)
    },

    consumptionByColumn: async (workspaceId: string, opts) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      const canMargin = canViewMargin(role)
      const nameById = new Map(this.store.data.columns.map((c) => [c.id, c.name] as const))
      return this.consumption(workspaceId, canMargin, opts?.since, (r) => ({ key: r.columnId, label: nameById.get(r.columnId) ?? r.columnId }))
    },

    consumptionByTable: async (workspaceId: string, opts) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      const canMargin = canViewMargin(role)
      const nameById = new Map(this.store.data.tables.map((t) => [t.id, t.name] as const))
      return this.consumption(workspaceId, canMargin, opts?.since, (r) => ({ key: r.tableId, label: nameById.get(r.tableId) ?? r.tableId }))
    },

    consumptionByModel: async (workspaceId: string, opts) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      return this.ledgerConsumptionByModel(workspaceId, canViewMargin(role), opts?.since)
    },
  }

  // ======================================================================
  // Billing (Phase 4) — plans, subscription, invoices, credit packs.
  // Billing consumption derives solely from the Phase 2 credit ledger (FR-4.1).
  // ======================================================================

  private nowIso(): string {
    return new Date().toISOString()
  }
  private addDaysIso(iso: string, days: number): string {
    return new Date(Date.parse(iso) + days * 86400_000).toISOString()
  }

  /** The plan a workspace is subscribed to (catalog copy). */
  private planFor(workspaceId: string): Plan | null {
    const sub = this.store.getSubscription(workspaceId)
    if (!sub) return null
    return this.store.getPlan(sub.planId) ?? planById(sub.planId) ?? null
  }

  /** Seats consumed = active members + pending invites (US-4.14). */
  private seatsUsed(workspaceId: string): number {
    const members = this.store.data.members.filter((m) => m.workspaceId === workspaceId && m.status === 'active').length
    const pending = this.store.data.invites.filter((i) => i.workspaceId === workspaceId && i.status === 'pending').length
    return members + pending
  }

  /** Grant credits atomically: bump balance + append a positive ledger row (mirrors tryCharge). */
  private grantCredits(workspaceId: string, credits: number, reason: string): void {
    if (credits <= 0) return
    let wc = this.store.getWorkspaceCredit(workspaceId)
    if (!wc) {
      wc = { workspaceId, balance: 0, budgetCap: 0, perRunCap: 0 }
      this.store.data.workspaceCredits.push(wc)
    }
    wc.balance += credits
    this.store.data.creditLedger.push({ id: newId(), workspaceId, delta: credits, reason, balanceAfter: wc.balance, createdAt: this.nowIso() })
  }

  /** Provision a workspace's subscription + initial included-credit grant. */
  private provisionBilling(workspaceId: string, planId: string | undefined): Subscription {
    if (this.store.data.plans.length === 0) this.store.data.plans = PLANS.map((p) => ({ ...p }))
    const plan = (planId ? planById(planId) : undefined) ?? planByTier('free')!
    const now = this.nowIso()
    let sub = this.store.getSubscription(workspaceId)
    if (!sub) {
      sub = {
        id: newId(),
        workspaceId,
        planId: plan.id,
        stripeSubscriptionId: `sub_mock_${newId().slice(0, 8)}`,
        status: 'active',
        currentPeriodEnd: this.addDaysIso(now, 30),
        cancelAtPeriodEnd: false,
        createdAt: now,
      }
      this.store.data.subscriptions.push(sub)
    } else {
      sub.planId = plan.id
    }
    if (!this.store.getWorkspaceCredit(workspaceId)) {
      this.store.data.workspaceCredits.push({
        workspaceId,
        balance: 0,
        budgetCap: plan.includedCredits,
        perRunCap: Math.min(5000, Math.max(500, Math.floor(plan.includedCredits / 4))),
      })
      this.grantCredits(workspaceId, plan.includedCredits, `plan:grant:${sub.id}`)
    }
    return sub
  }

  /** Credits consumed (|Σ negative deltas|) for a workspace since a timestamp. */
  private consumedSince(workspaceId: string, sinceIso?: string): number {
    let total = 0
    for (const e of this.store.data.creditLedger) {
      if (e.workspaceId !== workspaceId || e.delta >= 0) continue
      if (sinceIso && e.createdAt < sinceIso) continue
      total += -e.delta
    }
    return total
  }

  /** Provider + LLM cost (COGS) for a workspace since a timestamp, USD. */
  private cogsUsd(workspaceId: string, sinceIso?: string): number {
    const sum = (buckets: ConsumptionBucket[]) => buckets.reduce((s, b) => s + (b.providerCostUsd ?? 0), 0)
    const prov = sum(this.ledgerConsumptionByProvider(workspaceId, true, sinceIso))
    const model = sum(this.ledgerConsumptionByModel(workspaceId, true, sinceIso))
    return Math.round((prov + model) * 100) / 100
  }

  private billingSummary(workspaceId: string): BillingSummary {
    const sub = this.store.getSubscription(workspaceId) ?? null
    const plan = this.planFor(workspaceId)
    const wc = this.store.getWorkspaceCredit(workspaceId)
    const balance = wc?.balance ?? 0
    const included = plan?.includedCredits ?? 0
    const periodStart = sub ? this.addDaysIso(sub.currentPeriodEnd, -30) : undefined
    const usedThisPeriod = this.consumedSince(workspaceId, periodStart)
    const overageCredits = Math.max(0, usedThisPeriod - included)
    const overageUsd = plan && plan.overagePolicy === 'bill' ? overageCredits * plan.overageUsdPerCredit : 0
    const nextChargeUsd = sub && !sub.cancelAtPeriodEnd && plan ? Math.round((plan.priceUsdMonthly + overageUsd) * 100) / 100 : 0
    return {
      subscription: sub ? snap(sub) : null,
      plan: plan ? { ...plan } : null,
      balance,
      includedCredits: included,
      usedThisPeriod,
      overageCredits,
      nextChargeUsd,
      renewsAt: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      seats: { used: this.seatsUsed(workspaceId), limit: plan?.seatLimit ?? 0 },
    }
  }

  billing: BillingApi = {
    plans: {
      list: async () => {
        await this.delay()
        return this.store.data.plans.length ? snapList(this.store.data.plans) : PLANS.map((p) => ({ ...p }))
      },
    },
    summary: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId)
      return this.billingSummary(workspaceId)
    },
    changePlan: async (workspaceId: string, planId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      if (!canManageSubscription(role)) throw new ForbiddenError('Only the workspace owner can change the plan')
      const plan = planById(planId) ?? this.store.getPlan(planId)
      if (!plan) throw new NotFoundError('Plan not found')
      let sub = this.store.getSubscription(workspaceId)
      if (!sub) sub = this.provisionBilling(workspaceId, planId)
      const prevPlan = this.store.getPlan(sub.planId) ?? planById(sub.planId)
      const upgrading = prevPlan ? PLAN_RANK[plan.tier] > PLAN_RANK[prevPlan.tier] : true
      // US-4.4 — a downgrade whose seat limit is below current usage is blocked
      // with a clear message (the workspace must reduce seats first).
      if (prevPlan && PLAN_RANK[plan.tier] < PLAN_RANK[prevPlan.tier]) {
        const seats = this.seatsUsed(workspaceId)
        if (seats > plan.seatLimit) {
          throw new ValidationError(`${plan.name} allows ${plan.seatLimit} seats but this workspace uses ${seats}. Remove members before downgrading.`)
        }
      }
      sub.planId = plan.id
      sub.cancelAtPeriodEnd = false
      sub.status = 'active'
      // Proration (US-4.4): on upgrade, top the balance UP TO the new plan's
      // included credits. Using a top-up (not a raw +difference) makes plan
      // changes idempotent — cycling down→up can't farm free credits.
      if (upgrading) {
        const wc = this.store.getWorkspaceCredit(workspaceId)
        const shortfall = plan.includedCredits - (wc?.balance ?? 0)
        if (shortfall > 0) this.grantCredits(workspaceId, shortfall, `plan:upgrade:${sub.id}`)
      }
      this.writeAudit(workspaceId, 'plan.change', 'subscription', sub.id, { to: plan.name })
      this.persist()
      return snap(sub)
    },
    setCancel: async (workspaceId: string, cancelAtPeriodEnd: boolean) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      if (!canManageSubscription(role)) throw new ForbiddenError('Only the workspace owner can change the subscription')
      const sub = this.store.getSubscription(workspaceId)
      if (!sub) throw new NotFoundError('No subscription for this workspace')
      sub.cancelAtPeriodEnd = cancelAtPeriodEnd
      if (cancelAtPeriodEnd) this.writeAudit(workspaceId, 'subscription.cancel', 'subscription', sub.id, { atPeriodEnd: sub.currentPeriodEnd })
      this.persist()
      return snap(sub)
    },
    purchaseCredits: async (workspaceId: string, input: { credits: number; amountUsd: number }) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      if (!canManageSubscription(role)) throw new ForbiddenError('Only the workspace owner can buy credits')
      if (input.credits <= 0) throw new ValidationError('Choose a credit pack')
      const now = this.nowIso()
      const purchase: CreditPurchase = {
        id: newId(),
        workspaceId,
        credits: input.credits,
        amountUsd: input.amountUsd,
        stripePaymentId: `pi_mock_${newId().slice(0, 8)}`,
        createdAt: now,
      }
      this.store.data.creditPurchases.push(purchase)
      this.grantCredits(workspaceId, input.credits, `purchase:${purchase.id}`)
      const inv: Invoice = {
        id: newId(),
        workspaceId,
        stripeInvoiceId: `in_mock_${newId().slice(0, 8)}`,
        periodStart: now,
        periodEnd: now,
        amountUsd: input.amountUsd,
        status: 'paid',
        lines: [{ label: `${input.credits.toLocaleString('en-US')} credit pack`, amountUsd: input.amountUsd, credits: input.credits }],
        createdAt: now,
      }
      this.store.data.invoices.push(inv)
      this.writeAudit(workspaceId, 'credit.purchase', 'creditPurchase', purchase.id, { credits: input.credits, amountUsd: input.amountUsd })
      this.persist()
      return snap(purchase)
    },
    purchases: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId)
      return snapList(this.store.data.creditPurchases.filter((p) => p.workspaceId === workspaceId).sort(byCreatedDesc))
    },
    invoices: async (workspaceId: string) => {
      await this.delay()
      const role = this.roleFor(workspaceId)
      if (!canManageSubscription(role)) throw new ForbiddenError('Only the workspace owner can view invoices')
      return snapList(this.store.data.invoices.filter((i) => i.workspaceId === workspaceId).sort(byCreatedDesc))
    },
    seatUsage: async (workspaceId: string) => {
      await this.delay()
      this.roleFor(workspaceId)
      const plan = this.planFor(workspaceId)
      return { used: this.seatsUsed(workspaceId), limit: plan?.seatLimit ?? 0 }
    },
  }

  // ======================================================================
  // Platform superadmin (Phase 4) — a SEPARATE session/identity, never a
  // workspace role (FR-4.2). Cross-tenant; the one place unscoped reads are OK.
  // ======================================================================

  private resolvePlatformSession(state: PlatformSessionState): PlatformSession | null {
    const pu = this.store.data.platformUsers.find((p) => p.id === state.platformUserId)
    if (!pu) return null
    return { platformUser: snap(pu), token: state.token, expiresAt: state.expiresAt }
  }

  private platformActor(): PlatformUser {
    const state = this.store.data.platformSession
    const pu = state ? this.store.data.platformUsers.find((p) => p.id === state.platformUserId) : undefined
    if (!pu) throw new ForbiddenError('Superadmin sign-in required')
    return pu
  }

  private writePlatformAudit(actor: PlatformUser, action: PlatformAuditEntry['action'], targetType: PlatformAuditEntry['targetType'], targetId: string, detail: Record<string, unknown>): void {
    this.store.data.platformAudit.push({ id: newId(), platformUserId: actor.id, platformUserName: actor.name, action, targetType, targetId, detail, createdAt: this.nowIso() })
  }

  private platformWorkspaceSummary(ws: Workspace): PlatformWorkspaceSummary {
    const owner = this.user(ws.ownerUserId)
    const sub = this.store.getSubscription(ws.id)
    const plan = this.planFor(ws.id)
    const wc = this.store.getWorkspaceCredit(ws.id)
    const suspended = (ws.status ?? 'active') === 'suspended'
    const contributes = !!sub && sub.status === 'active' && !sub.cancelAtPeriodEnd && !suspended
    return {
      workspace: snap(ws),
      ownerName: owner?.name ?? '—',
      ownerEmail: owner?.email ?? '—',
      plan: plan ? { ...plan } : null,
      status: sub?.status ?? 'active',
      balance: wc?.balance ?? 0,
      seats: this.seatsUsed(ws.id),
      creditsConsumed: this.consumedSince(ws.id),
      cogsUsd: this.cogsUsd(ws.id),
      mrrUsd: contributes ? plan?.priceUsdMonthly ?? 0 : 0,
      suspended,
    }
  }

  private computePlatformAnalytics(sinceIso?: string): PlatformAnalytics {
    let mrrUsd = 0
    let cogsUsd = 0
    let paid = 0
    let free = 0
    let active = 0
    let suspended = 0
    const byPlan = new Map<string, { name: string; mrr: number; ws: number }>()
    for (const ws of this.store.data.workspaces) {
      const sub = this.store.getSubscription(ws.id)
      const plan = this.planFor(ws.id)
      const isSuspended = (ws.status ?? 'active') === 'suspended'
      if (isSuspended) suspended += 1
      else active += 1
      const price = plan?.priceUsdMonthly ?? 0
      const contributes = !!sub && sub.status === 'active' && !sub.cancelAtPeriodEnd && !isSuspended
      if (price > 0 && contributes) {
        mrrUsd += price
        paid += 1
        if (plan) {
          const b = byPlan.get(plan.id) ?? { name: plan.name, mrr: 0, ws: 0 }
          b.mrr += price
          b.ws += 1
          byPlan.set(plan.id, b)
        }
      } else if (price === 0) {
        free += 1
      }
      cogsUsd += this.cogsUsd(ws.id, sinceIso)
    }
    let revenueUsd = 0
    for (const inv of this.store.data.invoices) {
      if (inv.status !== 'paid') continue
      if (sinceIso && inv.createdAt < sinceIso) continue
      revenueUsd += inv.amountUsd
    }
    const grossMarginUsd = Math.round((revenueUsd - cogsUsd) * 100) / 100
    const marginPct = revenueUsd > 0 ? Math.round((grossMarginUsd / revenueUsd) * 100) : 0
    const conversion = paid + free > 0 ? Math.round((paid / (paid + free)) * 100) / 100 : 0
    const byMonth = new Map<string, number>()
    for (const e of this.store.data.creditLedger) {
      if (e.delta >= 0) continue
      const month = e.createdAt.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + -e.delta)
    }
    const consumptionTrend = [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6)
      .map(([label, credits]) => ({ label, credits }))
    return {
      mrrUsd: Math.round(mrrUsd * 100) / 100,
      arrUsd: Math.round(mrrUsd * 12 * 100) / 100,
      activeWorkspaces: active,
      suspendedWorkspaces: suspended,
      paidWorkspaces: paid,
      freeWorkspaces: free,
      conversion,
      cogsUsd: Math.round(cogsUsd * 100) / 100,
      grossMarginUsd,
      marginPct,
      mrrByPlan: [...byPlan.entries()].map(([planId, v]) => ({ planId, planName: v.name, mrrUsd: v.mrr, workspaces: v.ws })).sort((a, b) => b.mrrUsd - a.mrrUsd),
      consumptionTrend,
    }
  }

  platform: PlatformApi = {
    auth: {
      signIn: async (email: string) => {
        await this.delay()
        const pu = this.store.data.platformUsers.find((p) => p.email.toLowerCase() === email.trim().toLowerCase())
        if (!pu) throw new ApiError('Invalid platform credentials', 'invalid_credentials', 401)
        const state: PlatformSessionState = { platformUserId: pu.id, token: `mockp-${newId()}`, expiresAt: this.addDaysIso(this.nowIso(), 7) }
        this.store.data.platformSession = state
        this.persist()
        return this.resolvePlatformSession(state)!
      },
      currentSession: async () => {
        await this.delay()
        const state = this.store.data.platformSession
        return state ? this.resolvePlatformSession(state) : null
      },
      signOut: async () => {
        await this.delay()
        this.store.data.platformSession = null
        this.persist()
      },
    },
    workspaces: {
      list: async () => {
        await this.delay()
        this.platformActor()
        return this.store.data.workspaces.map((w) => this.platformWorkspaceSummary(w)).sort((a, b) => b.mrrUsd - a.mrrUsd)
      },
      get: async (workspaceId: string) => {
        await this.delay()
        this.platformActor()
        const ws = this.store.data.workspaces.find((w) => w.id === workspaceId)
        if (!ws) throw new NotFoundError('Workspace not found')
        return this.platformWorkspaceSummary(ws)
      },
      members: async (workspaceId: string) => {
        await this.delay()
        this.platformActor()
        return snapList(this.store.data.members.filter((m) => m.workspaceId === workspaceId && m.status === 'active'))
      },
      setSuspended: async (workspaceId: string, suspended: boolean, reason: string) => {
        await this.delay()
        const actor = this.platformActor()
        if (!canOperateWorkspaces(actor.platformRole)) throw new ForbiddenError('Platform admin required')
        const ws = this.store.data.workspaces.find((w) => w.id === workspaceId)
        if (!ws) throw new NotFoundError('Workspace not found')
        ws.status = suspended ? 'suspended' : 'active'
        this.writePlatformAudit(actor, suspended ? 'workspace.suspend' : 'workspace.reactivate', 'workspace', workspaceId, { reason })
        this.persist()
        return snap(ws)
      },
      deactivateUser: async (workspaceId: string, userId: string, reason: string) => {
        await this.delay()
        const actor = this.platformActor()
        if (!canOperateWorkspaces(actor.platformRole)) throw new ForbiddenError('Platform admin required')
        const member = this.store.data.members.find((m) => m.workspaceId === workspaceId && m.userId === userId)
        if (!member) throw new NotFoundError('Member not found')
        if (member.role === 'owner') throw new ValidationError('Cannot deactivate the workspace owner')
        member.status = 'suspended'
        this.writePlatformAudit(actor, 'user.deactivate', 'user', userId, { workspaceId, email: member.email, reason })
        this.persist()
      },
      compCredits: async (workspaceId: string, credits: number, reason: string) => {
        await this.delay()
        const actor = this.platformActor()
        if (!canIssueBillingExceptions(actor.platformRole)) throw new ForbiddenError('Platform admin required')
        if (credits <= 0) throw new ValidationError('Enter a positive credit amount')
        if (!reason.trim()) throw new ValidationError('A reason is required for comped credits')
        if (!this.store.data.workspaces.some((w) => w.id === workspaceId)) throw new NotFoundError('Workspace not found')
        this.grantCredits(workspaceId, credits, `comp:${reason.trim()}`)
        this.writePlatformAudit(actor, 'credit.comp', 'workspace', workspaceId, { credits, reason: reason.trim() })
        this.persist()
      },
      overridePlan: async (workspaceId: string, planId: string, reason: string) => {
        await this.delay()
        const actor = this.platformActor()
        if (!canIssueBillingExceptions(actor.platformRole)) throw new ForbiddenError('Platform admin required')
        const plan = planById(planId) ?? this.store.getPlan(planId)
        if (!plan) throw new NotFoundError('Plan not found')
        let sub = this.store.getSubscription(workspaceId)
        if (!sub) sub = this.provisionBilling(workspaceId, planId)
        else sub.planId = plan.id
        this.writePlatformAudit(actor, 'plan.override', 'subscription', sub.id, { to: plan.name, reason })
        this.persist()
        return snap(sub)
      },
    },
    invoices: {
      list: async (workspaceId: string) => {
        await this.delay()
        this.platformActor()
        return snapList(this.store.data.invoices.filter((i) => i.workspaceId === workspaceId).sort(byCreatedDesc))
      },
      refund: async (invoiceId: string, reason: string) => {
        await this.delay()
        const actor = this.platformActor()
        if (!canIssueBillingExceptions(actor.platformRole)) throw new ForbiddenError('Platform admin required')
        if (!reason.trim()) throw new ValidationError('A reason is required for a refund')
        const inv = this.store.data.invoices.find((i) => i.id === invoiceId)
        if (!inv) throw new NotFoundError('Invoice not found')
        if (inv.status === 'refunded') throw new ValidationError('Invoice already refunded')
        inv.status = 'refunded'
        this.writePlatformAudit(actor, 'refund.issue', 'invoice', invoiceId, { amountUsd: inv.amountUsd, workspaceId: inv.workspaceId, reason: reason.trim() })
        this.persist()
        return snap(inv)
      },
    },
    analytics: async (opts) => {
      await this.delay()
      this.platformActor()
      return this.computePlatformAnalytics(opts?.since)
    },
    audit: async (opts) => {
      await this.delay()
      this.platformActor()
      const entries = this.store.data.platformAudit.slice().sort(byCreatedDesc)
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? entries.length
      return snapList(entries.slice(offset, offset + limit))
    },
  }

  // ======================================================================
  // Debug / perf helpers (not part of the CascadeApi contract)
  // ======================================================================

  /** Resolves when no enrichment run is active (tests). */
  async __drainEnrichment(): Promise<void> {
    await this.engine.whenIdle()
  }

  /** Resolves when no AI run is active (tests). */
  async __drainAi(): Promise<void> {
    await this.aiEngine.whenIdle()
  }

  /** Resolves when no agent run is active (tests). */
  async __drainAgent(): Promise<void> {
    await this.agentEngine.whenIdle()
  }

  /** Resolves when no HTTP run is active (tests). */
  async __drainHttp(): Promise<void> {
    await this.httpEngine.whenIdle()
  }

  /** Resolves when no engine has an active run (tests). */
  async __drain(): Promise<void> {
    await Promise.all([
      this.engine.whenIdle(),
      this.aiEngine.whenIdle(),
      this.agentEngine.whenIdle(),
      this.httpEngine.whenIdle(),
    ])
  }

  /** Append `n` synthesised rows to a table for perf testing. Returns new count. */
  loadPerfRows(tableId: string, n: number): number {
    const columns = this.columnsForTable(tableId)
    const start = this.store.data.records.filter((r) => r.tableId === tableId).length
    const { records, cells } = generateRows(tableId, columns, n, start)
    this.store.data.records.push(...records)
    this.store.addCells(cells)
    this.persist()
    return start + n
  }

  /** Reset to a fresh seed (clears persisted state). */
  reset(): void {
    Store.clear(this.key)
    this.store = new Store(buildSeed())
    this.store.save(this.key)
    this.initEngine()
  }

  /** Direct access to the underlying store (for tests / debugging). */
  get rawStore(): Store {
    return this.store
  }
}

function cloneValue(value: CellValue): CellValue {
  return Array.isArray(value) ? [...value] : value
}

/** Shallow snapshot so callers never hold a live reference into the store. */
function snap<T>(x: T): T {
  return { ...x }
}
function snapList<T>(xs: T[]): T[] {
  return xs.map((x) => ({ ...x }))
}
/** Newest-first sort by an ISO `createdAt` field. */
function byCreatedDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

// --- Phase 3 automation/integration helpers --------------------------------

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'hook'
}

/** Small deterministic hash for mock CRM counts (distinct from the FNV in core). */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function crmLabel(p: CrmProvider): string {
  return p === 'hubspot' ? 'HubSpot' : p === 'salesforce' ? 'Salesforce' : 'Pipedrive'
}

const CRM_COMPANIES = ['Northwind', 'Zephyr Labs', 'Acme Co', 'Globex', 'Umbra', 'Vertex', 'Lumen', 'Cobalt']
const CRM_CITIES = ['Austin', 'Denver', 'Berlin', 'Toronto', 'Lisbon', 'Boston']

/** A deterministic mock CRM field value for a pulled record. */
function mockCrmValue(field: string, seed: string): unknown {
  const h = hashStr(field + seed)
  const f = field.toLowerCase()
  if (f.includes('email')) return `contact${h % 900 + 100}@${CRM_COMPANIES[h % CRM_COMPANIES.length]!.toLowerCase().replace(/\s+/g, '')}.com`
  if (f.includes('name') || f.includes('company') || f.includes('account')) return CRM_COMPANIES[h % CRM_COMPANIES.length]
  if (f.includes('domain') || f.includes('website') || f.includes('url')) return `https://${CRM_COMPANIES[h % CRM_COMPANIES.length]!.toLowerCase().replace(/\s+/g, '')}.com`
  if (f.includes('city') || f.includes('location')) return CRM_CITIES[h % CRM_CITIES.length]
  if (f.includes('employee') || f.includes('size') || f.includes('count')) return 20 + (h % 4800)
  if (f.includes('revenue') || f.includes('amount') || f.includes('value')) return (1 + (h % 90)) * 100000
  if (f.includes('phone')) return `+1 ${200 + (h % 799)} 555 ${String(h % 10000).padStart(4, '0')}`
  return CRM_COMPANIES[h % CRM_COMPANIES.length]
}
