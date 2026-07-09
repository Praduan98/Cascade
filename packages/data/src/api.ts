// The CascadeApi contract — a REST-shaped, fully-async interface. MockApi
// implements it today; a real HttpApi can implement it 1:1 later with no UI
// rework. Everything is workspace-scoped; there is no unscoped read path.

import type {
  AuditEntry,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  ColumnType,
  ColumnState,
  Invite,
  Member,
  Role,
  RowWithCells,
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
}

// Re-export the cell types consumers of the raw store may want.
export type { Cell }
