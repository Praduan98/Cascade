// CSV import engine — everything the wizard reasons about that isn't rendering.
// Parses a file (papaparse), infers a target type per CSV column by sampling,
// derives select options from the data, validates every row through the core
// column-type registry, and streams valid rows into the table in chunks via
// getApi() so a large import stays responsive.

import Papa from 'papaparse'
import {
  defaultConfigFor,
  getColumnType,
  newId,
  validateValue,
} from '@cascade/core'
import type { CellValue, ColumnConfig, ColumnType } from '@cascade/core'
import { getApi } from '@cascade/data'
import { OPTION_COLORS } from '../ColumnConfigFields'

/**
 * Rows per chunk when inserting. Kept modest: each mock `records.add` persists
 * the whole store, so a small chunk bounds the synchronous burst while we yield
 * to the event loop between chunks (progress paints, page stays responsive).
 */
export const IMPORT_CHUNK_SIZE = 50

/** How many non-empty values to sample per column when inferring its type. */
const SAMPLE_LIMIT = 60

/** Cap on auto-generated options for a new select column. */
const MAX_DERIVED_OPTIONS = 200

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  fileName: string
  /** All physical rows, each a list of raw string cells. Empty rows dropped. */
  rows: string[][]
}

export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const rows = (res.data as unknown[][]).map((r) => r.map((c) => (c == null ? '' : String(c))))
        resolve({ fileName: file.name, rows })
      },
      error: (err: unknown) => reject(err instanceof Error ? err : new Error('Could not read the file')),
    })
  })
}

/** Spreadsheet-style column label for a 0-based index: 0→A, 25→Z, 26→AA. */
export function columnLetter(index: number): string {
  let n = index
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

// ---------------------------------------------------------------------------
// A parsed file resolved into header + data rows for a given header choice
// ---------------------------------------------------------------------------

export interface CsvColumnInfo {
  index: number
  header: string
  /** Distinct-ish sampled values used to infer a type. */
  samples: string[]
}

/** Number of CSV columns = the widest row. */
export function columnCount(rows: string[][]): number {
  return rows.reduce((max, r) => Math.max(max, r.length), 0)
}

/** The rows carrying data, given whether the first row is a header. */
export function dataRowsOf(rows: string[][], hasHeader: boolean): string[][] {
  return hasHeader ? rows.slice(1) : rows
}

/** Per-column header labels + inference samples for the current header choice. */
export function describeColumns(rows: string[][], hasHeader: boolean): CsvColumnInfo[] {
  const count = columnCount(rows)
  const headerRow = hasHeader ? rows[0] ?? [] : []
  const data = dataRowsOf(rows, hasHeader)
  const cols: CsvColumnInfo[] = []
  for (let i = 0; i < count; i++) {
    const rawHeader = hasHeader ? (headerRow[i] ?? '').trim() : ''
    const header = rawHeader !== '' ? rawHeader : `Column ${columnLetter(i)}`
    const samples: string[] = []
    for (const row of data) {
      const v = (row[i] ?? '').trim()
      if (v !== '') samples.push(v)
      if (samples.length >= SAMPLE_LIMIT) break
    }
    cols.push({ index: i, header, samples })
  }
  return cols
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

const STRICT_BOOL = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 'checked', 'unchecked', 'on', 'off'])
const URLISH = /^(https?:\/\/|www\.)\S+$/i

function allValidNonEmpty(type: ColumnType, values: string[]): boolean {
  const cfg = defaultConfigFor(type)
  const def = getColumnType(type)
  return values.every((v) => {
    const r = validateValue(type, v, cfg)
    return r.ok && !def.isEmpty(r.value)
  })
}

/**
 * Best-guess column type from sampled values. Order matters: boolean and number
 * are checked before the looser string formats, and url/phone use tighter
 * pre-tests to avoid classifying ordinary text (e.g. "john.doe") as a URL.
 */
export function inferColumnType(samples: string[]): ColumnType {
  const vals = samples.map((s) => s.trim()).filter((s) => s !== '')
  if (vals.length === 0) return 'text'
  if (vals.every((v) => STRICT_BOOL.has(v.toLowerCase()))) return 'boolean'
  if (allValidNonEmpty('number', vals)) return 'number'
  if (allValidNonEmpty('date', vals)) return 'date'
  if (allValidNonEmpty('email', vals)) return 'email'
  if (vals.every((v) => URLISH.test(v)) && allValidNonEmpty('url', vals)) return 'url'
  if (vals.some((v) => /\D/.test(v)) && allValidNonEmpty('phone', vals)) return 'phone'
  return 'text'
}

// ---------------------------------------------------------------------------
// Config derivation (auto-build select options from the data)
// ---------------------------------------------------------------------------

/**
 * The config a NEW column of `type` should be created with. Select types have no
 * options by default, which would reject every value, so we synthesise options
 * from the distinct values actually present in `values`.
 */
export function deriveConfig(type: ColumnType, values: string[]): ColumnConfig {
  if (type !== 'singleSelect' && type !== 'multiSelect') return defaultConfigFor(type)
  const seen = new Set<string>()
  const labels: string[] = []
  for (const raw of values) {
    const tokens =
      type === 'multiSelect'
        ? raw.split(/[,;]/).map((s) => s.trim())
        : [raw.trim()]
    for (const t of tokens) {
      if (t === '') continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      labels.push(t)
      if (labels.length >= MAX_DERIVED_OPTIONS) break
    }
    if (labels.length >= MAX_DERIVED_OPTIONS) break
  }
  const options = labels.map((label, i) => ({
    id: newId(),
    label,
    color: OPTION_COLORS[i % OPTION_COLORS.length] as string,
  }))
  return { type, options } as ColumnConfig
}

// ---------------------------------------------------------------------------
// Mapping model
// ---------------------------------------------------------------------------

export type TargetKind = 'skip' | 'new' | 'existing'

/** The user's editable choice for one CSV column. */
export interface MappingChoice {
  csvIndex: number
  header: string
  kind: TargetKind
  newName: string
  newType: ColumnType
  existingColumnId: string
}

/** A mapping fully resolved to a concrete target type + config, ready to run. */
export interface ResolvedMapping {
  csvIndex: number
  columnName: string
  type: ColumnType
  config: ColumnConfig
  isNew: boolean
  existingColumnId?: string
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RowError {
  /** 1-based index within the data rows (excludes the header). */
  rowNumber: number
  column: string
  value: string
  reason: string
}

export interface ValidationReport {
  totalRows: number
  validRowIndices: number[]
  errorRowCount: number
  errors: RowError[]
  /** dataRowIndex → (resolvedMappingIndex → coerced value) for valid rows. */
  values: Map<number, Record<number, CellValue>>
}

/** Cap on how many individual errors we retain for display. */
const MAX_REPORTED_ERRORS = 200

export function validateImport(dataRows: string[][], resolved: ResolvedMapping[]): ValidationReport {
  const errors: RowError[] = []
  const values = new Map<number, Record<number, CellValue>>()
  const validRowIndices: number[] = []
  let errorRowCount = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] ?? []
    let rowOk = true
    const rowValues: Record<number, CellValue> = {}
    for (let m = 0; m < resolved.length; m++) {
      const rm = resolved[m]
      if (!rm) continue
      const raw = row[rm.csvIndex] ?? ''
      const res = validateValue(rm.type, raw, rm.config)
      if (res.ok) {
        rowValues[m] = res.value
      } else {
        rowOk = false
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ rowNumber: i + 1, column: rm.columnName, value: raw, reason: res.error })
        }
      }
    }
    if (rowOk) {
      validRowIndices.push(i)
      values.set(i, rowValues)
    } else {
      errorRowCount++
    }
  }

  return { totalRows: dataRows.length, validRowIndices, errorRowCount, errors, values }
}

// ---------------------------------------------------------------------------
// The chunked import runner
// ---------------------------------------------------------------------------

export interface ImportProgress {
  phase: 'columns' | 'rows'
  created: number
  total: number
}

export interface ImportOutcome {
  imported: number
  skipped: number
  columnsCreated: number
  cancelled: boolean
}

export interface RunImportArgs {
  tableId: string
  resolved: ResolvedMapping[]
  report: ValidationReport
  onProgress: (p: ImportProgress) => void
  /** Polled between chunks; return true to stop early. */
  shouldCancel: () => boolean
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function runImport(args: RunImportArgs): Promise<ImportOutcome> {
  const { tableId, resolved, report, onProgress, shouldCancel } = args
  const api = getApi()

  // 1) Create any new columns first, recording each mapping's target columnId.
  const columnIdByMapping: (string | undefined)[] = new Array(resolved.length).fill(undefined)
  let columnsCreated = 0
  for (let m = 0; m < resolved.length; m++) {
    const rm = resolved[m]
    if (!rm) continue
    if (rm.isNew) {
      onProgress({ phase: 'columns', created: columnsCreated, total: 0 })
      const col = await api.columns.add(tableId, { name: rm.columnName, type: rm.type, config: rm.config })
      columnIdByMapping[m] = col.id
      columnsCreated++
    } else {
      columnIdByMapping[m] = rm.existingColumnId
    }
  }

  // 2) Insert valid rows in chunks. Explicit, increasing positions preserve CSV
  //    order regardless of the concurrency within a chunk.
  const indices = report.validRowIndices
  const total = indices.length
  const base = await api.records.count(tableId)
  let created = 0
  let cancelled = false
  onProgress({ phase: 'rows', created: 0, total })

  for (let start = 0; start < total; start += IMPORT_CHUNK_SIZE) {
    if (shouldCancel()) {
      cancelled = true
      break
    }
    const slice = indices.slice(start, start + IMPORT_CHUNK_SIZE)
    await Promise.all(
      slice.map((dataRowIdx, k) => {
        const rowValues = report.values.get(dataRowIdx) ?? {}
        const cells: Record<string, CellValue> = {}
        for (let m = 0; m < resolved.length; m++) {
          const colId = columnIdByMapping[m]
          if (!colId) continue
          if (!(m in rowValues)) continue
          const v = rowValues[m]
          if (v !== undefined) cells[colId] = v
        }
        return api.records.add(tableId, { position: base + start + k, cells })
      }),
    )
    created += slice.length
    onProgress({ phase: 'rows', created, total })
    await yieldToUi()
  }

  return {
    imported: created,
    skipped: report.totalRows - created,
    columnsCreated,
    cancelled,
  }
}
