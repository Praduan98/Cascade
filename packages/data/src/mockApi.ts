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
  AuditAction,
  AuditTargetType,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  Invite,
  Member,
  RecordRow,
  Role,
  RowWithCells,
  TableMeta,
  User,
  View,
  Workspace,
} from '@cascade/core'
import type { FilterGroup, SortSpec } from '@cascade/core'
import {
  canManageMembers,
  canViewAudit,
  canWrite,
  coerceColumnValue,
  columnTypeRegistry,
  defaultConfigFor,
  emptyFilter,
  evaluateFilter,
  makeComparator,
  newId,
  validateValue,
} from '@cascade/core'

import type {
  AddColumnInput,
  AddRecordInput,
  AuditApi,
  AuthApi,
  CascadeApi,
  CellEdit,
  CellsApi,
  CellUpdate,
  CellConflict,
  ColumnsApi,
  CreateViewInput,
  ListRecordsOptions,
  ListRecordsResult,
  MembersApi,
  PatchCellsResult,
  RecordsApi,
  Session,
  TablesApi,
  UpdateColumnInput,
  UpdateViewInput,
  ViewsApi,
  WorkspacesApi,
} from './api'
import { ApiError, ForbiddenError, NotFoundError, ValidationError } from './errors'
import { STORAGE_KEY, Store } from './store'
import type { SessionState, StoreData } from './store'
import { buildSeed, generateRows } from './seed'

export interface MockApiOptions {
  /** Simulate network latency (default true). Disable for fast tests. */
  latency?: boolean
  storageKey?: string
  /** Override the initial dataset (defaults to the built-in seed). */
  seedData?: StoreData
}

export class MockApi implements CascadeApi {
  private store: Store
  private readonly key: string
  private readonly latencyOn: boolean

  constructor(opts: MockApiOptions = {}) {
    this.latencyOn = opts.latency ?? true
    this.key = opts.storageKey ?? STORAGE_KEY
    const loaded = Store.load(this.key)
    if (loaded) {
      this.store = loaded
    } else {
      this.store = new Store(opts.seedData ?? buildSeed())
      this.store.save(this.key)
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
      const { role } = this.tableScope(tableId)
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
  // Debug / perf helpers (not part of the CascadeApi contract)
  // ======================================================================

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
