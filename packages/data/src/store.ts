// In-memory data model + best-effort localStorage persistence. The Store owns
// the arrays and maintains a fast cell index (recordId|columnId → Cell). It is
// framework-agnostic: `localStorage` is used only if present (browser), and
// writes are wrapped so quota errors (e.g. a 100k-row perf dataset) degrade to
// memory-only rather than throwing.

import type {
  AuditEntry,
  Cell,
  Column,
  Invite,
  Member,
  RecordRow,
  TableMeta,
  User,
  View,
  Workspace,
} from '@cascade/core'

export interface SessionState {
  userId: string
  workspaceId: string
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
}

export const STORAGE_KEY = 'cascade:store:v1'
const SCHEMA_VERSION = 1

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
  }
}

function cellKey(recordId: string, columnId: string): string {
  return `${recordId}|${columnId}`
}

export class Store {
  data: StoreData
  /** recordId|columnId → Cell, rebuilt on load / mutation for O(1) access. */
  private cellIndex = new Map<string, Cell>()

  constructor(data: StoreData = emptyStoreData()) {
    this.data = data
    this.rebuildIndex()
  }

  rebuildIndex(): void {
    this.cellIndex.clear()
    for (const cell of this.data.cells) {
      this.cellIndex.set(cellKey(cell.recordId, cell.columnId), cell)
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
      const data = Store.deserialize(json)
      if (data.version !== SCHEMA_VERSION) return null
      return new Store(data)
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
