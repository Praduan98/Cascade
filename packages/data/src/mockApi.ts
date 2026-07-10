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
  AiColumnConfig,
  AiModelInfo,
  AuditAction,
  AuditTargetType,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  EnrichmentColumnConfig,
  EnrichmentOperation,
  EnrichmentRun,
  Invite,
  Member,
  Provider,
  ProviderCredential,
  RecordRow,
  Role,
  RowWithCells,
  RunScope,
  TableMeta,
  User,
  View,
  Workspace,
} from '@cascade/core'
import type { FilterGroup, SortSpec } from '@cascade/core'
import {
  AI_OPERATIONS,
  canManageBilling,
  canManageMembers,
  canManageProviders,
  canViewAudit,
  canViewMargin,
  canWrite,
  coerceColumnValue,
  columnTypeRegistry,
  defaultConfigFor,
  emptyFilter,
  evaluateFilter,
  makeComparator,
  newId,
  readAi,
  readEnrichment,
  validateValue,
} from '@cascade/core'

import type {
  AddColumnInput,
  AddRecordInput,
  AiApi,
  AiEvent,
  AuditApi,
  AuthApi,
  BalanceInfo,
  BudgetSettings,
  CacheStats,
  CascadeApi,
  CellEdit,
  CellsApi,
  CellUpdate,
  CellConflict,
  ColumnsApi,
  ConsumptionBucket,
  CreateViewInput,
  CreditsApi,
  EnrichmentApi,
  EnrichmentEvent,
  EstimateResult,
  ListRecordsOptions,
  ListRecordsResult,
  MembersApi,
  PatchCellsResult,
  RecordsApi,
  RunHandle,
  RunOptions,
  Session,
  TablesApi,
  UpdateColumnInput,
  UpsertAiConfigInput,
  UpsertConfigInput,
  UpsertCredentialInput,
  UpdateViewInput,
  ViewsApi,
  WorkspacesApi,
} from './api'
import { ApiError, BudgetError, ForbiddenError, NotFoundError, ValidationError } from './errors'
import { STORAGE_KEY, Store } from './store'
import type { SessionState, StoreData } from './store'
import { buildSeed, generateRows } from './seed'
import { buildCacheKey, byoActive, isEmptyInput, MockEnrichmentEngine } from './enrichmentEngine'
import type { RunTarget } from './enrichmentEngine'
import { buildAiCacheKey, MockAiEngine } from './aiEngine'
import type { AiRunTarget } from './aiEngine'
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

export class MockApi implements CascadeApi {
  private store: Store
  private readonly key: string
  private readonly latencyOn: boolean
  private readonly engineSync: boolean
  private engine!: MockEnrichmentEngine
  private aiEngine!: MockAiEngine
  private listeners = new Set<EnrichmentListener>()
  private aiListeners = new Set<AiListener>()

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
    this.engine.reconcileOnLoad()
    this.aiEngine.reconcileOnLoad()
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
      const workspace: Workspace = { id: newId(), name, ownerUserId: uid, createdAt: new Date().toISOString() }
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
      // US-2.7 / US-3.8 — auto-run enrichment and AI columns on the new row.
      this.triggerAutoRun(table, [record.id])
      this.triggerAiAutoRun(table, [record.id])
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

      for (const edit of edits) {
        const record = this.store.data.records.find((r) => r.id === edit.recordId)
        if (!record) throw new NotFoundError('Record not found')
        const { role } = this.tableScope(record.tableId)
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
      }

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
    if (!AI_OPERATIONS.includes(input.operation)) throw new ValidationError('Choose a valid AI operation')
    if (input.cacheTtlDays !== undefined && (!Number.isFinite(input.cacheTtlDays) || input.cacheTtlDays < 0)) {
      throw new ValidationError('Cache freshness must be a non-negative number of days')
    }
    const schema = input.outputSchema ?? []
    const mapping = input.outputMapping ?? {}
    const colIds = new Set(this.store.data.columns.filter((c) => c.tableId === table.id).map((c) => c.id))
    const seen = new Set<string>()
    for (const field of schema) {
      const name = field.name?.trim()
      if (!name) throw new ValidationError('Each output field needs a name')
      if (seen.has(name.toLowerCase())) throw new ValidationError(`Duplicate output field “${name}”`)
      seen.add(name.toLowerCase())
      // An unknown field type would index columnTypeRegistry[undefined] and crash
      // the run for every row — reject it at save (US-3.2).
      if (!columnTypeRegistry[field.type]) throw new ValidationError(`Output field “${name}” has an unknown type`)
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
        const key = buildAiCacheKey(modelInfo.key, config.operation, resolved, config.outputSchema)
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
      if (!wc) return null
      const cols = [...new Set(targets.map((t) => t.anchorColumnId))]
      const est = this.computeAiEstimate(table.id, { mode: 'selected', recordIds, columnIds: cols }, false, true)
      // A billable auto-run needs headroom; a fully non-billable (all-cached) one
      // still proceeds even at an exhausted balance (US-2.11 "non-billable continues").
      if (est.maxCredits > 0 && wc.balance <= 0) return null
      if (est.maxCredits > wc.perRunCap) return null
      return this.buildAiRun(table, { mode: 'selected', recordIds, columnIds: cols }, false, targets.length, 'Auto-run')
    })
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
        const { role } = this.columnScope(columnId)
        const cfg = this.store.getAiConfig(columnId)
        if (!cfg) return null
        // Provider cost / margin is Admin/Owner-only (US-3.15 / US-2.12).
        return canViewMargin(role) ? snap(cfg) : { ...snap(cfg), providerCostUsd: 0 }
      },
      list: async (tableId: string) => {
        await this.delay()
        const { role } = this.tableScope(tableId)
        const canMargin = canViewMargin(role)
        return this.store.getAiConfigsForTable(tableId).map((c) => (canMargin ? snap(c) : { ...snap(c), providerCostUsd: 0 }))
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

  /** Resolves when neither engine has an active run (tests). */
  async __drain(): Promise<void> {
    await Promise.all([this.engine.whenIdle(), this.aiEngine.whenIdle()])
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
