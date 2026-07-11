// MockHttpEngine — the Phase-3 HTTP-column resolver (US-3.5), on the SHARED
// execution pipeline (OperationRunner). Per row it substitutes {{Column}}
// references into a templated URL / headers / body, "calls" the endpoint
// (deterministic mock response + status code), maps a JSON path out of the body
// into the cell (plus optional fan-out columns), and charges credits. A non-2xx
// response is a Failed cell carrying the status code. Secrets are referenced by
// name and NEVER leave the server (FR-3.5) — the resolved request URL redacts
// them and headers with a secretRef are injected only inside this engine.

import type {
  CellValue,
  ColumnConfig,
  EnrichmentRun,
  HttpCellMeta,
  HttpCellResult,
  HttpColumnConfig,
  HttpMethod,
} from '@cascade/core'
import { columnTypeRegistry, defaultConfigFor, newId, parseTemplate, resolveTemplate } from '@cascade/core'
import type { HttpEvent } from './api'
import { isEmptyInput } from './enrichmentEngine'
import { frac, hashString, mulberry32, OperationRunner, PAUSE, snapshotRun } from './operationRunner'
import type { OpEngineDeps, OpTarget, TerminalStatus } from './operationRunner'

export type HttpEngineDeps = OpEngineDeps<HttpEvent>

export interface HttpRunTarget extends OpTarget {
  config: HttpColumnConfig
}

// ---------------------------------------------------------------------------
// JSON-path extraction (dot + [index]; `$` or '' = whole body)
// ---------------------------------------------------------------------------

export function getJsonPath(obj: unknown, path: string): unknown {
  const p = path.trim()
  if (p === '' || p === '$') return obj
  let cur: unknown = obj
  // normalize a[0].b → a.0.b
  const parts = p.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  for (const part of parts) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(part)
      cur = Number.isInteger(idx) ? cur[idx] : undefined
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return cur
}

/** Coerce an extracted JSON value into a cell-writable scalar/array. */
function toCellValue(v: unknown): CellValue {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)))
  return JSON.stringify(v)
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

export function buildHttpCacheKey(method: HttpMethod, resolvedUrl: string, resolvedBody: string): string {
  return `${method}|${resolvedUrl.trim()}|${hashString(resolvedBody.trim())}`
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

interface HttpWrite {
  columnId: string
  value: CellValue
  fieldName?: string | null
}
interface HttpFieldEmpty {
  columnId: string
  fieldName: string
  reason: string
}
interface HttpOutcome {
  status: TerminalStatus
  statusCode: number | null
  method: HttpMethod
  credits: number
  providerCostUsd: number
  fromCache: boolean
  reason?: string
  requestUrl?: string
  writes: HttpWrite[]
  fieldEmpties: HttpFieldEmpty[]
}

export class MockHttpEngine extends OperationRunner<HttpRunTarget, HttpOutcome, HttpEvent> {
  constructor(d: HttpEngineDeps) {
    super(d)
  }

  protected resolve(run: EnrichmentRun, t: HttpRunTarget): HttpOutcome | typeof PAUSE {
    return this.resolveHttp(run, t)
  }

  protected failureOutcome(reason: string): HttpOutcome {
    return { status: 'failed', statusCode: null, method: 'GET', credits: 0, providerCostUsd: 0, fromCache: false, reason, writes: [], fieldEmpties: [] }
  }

  protected emitRun(run: EnrichmentRun): void {
    this.d.emit({ type: 'run', run: snapshotRun(run) })
  }
  protected emitBudget(workspaceId: string, balance: number, paused: boolean): void {
    this.d.emit({ type: 'budget', workspaceId, balance, paused })
  }
  protected runsList(): EnrichmentRun[] {
    return this.d.store.data.httpRuns
  }
  protected cellMetaKey(): 'http' {
    return 'http'
  }

  reconcileOnLoad(): void {
    this.reconcile()
  }

  autoRun(
    tableId: string,
    recordIds: string[],
    makeRun: (targets: HttpRunTarget[]) => EnrichmentRun | null,
  ): EnrichmentRun | null {
    const configs = this.d.store.getHttpConfigsForTable(tableId).filter((c) => c.autoRun)
    if (configs.length === 0) return null
    const targets: HttpRunTarget[] = []
    let order = 0
    for (const rid of recordIds) {
      for (const cfg of configs) {
        if (this.refsPresent(rid, cfg)) {
          targets.push({ recordId: rid, anchorColumnId: cfg.columnId, config: cfg, orderIndex: order++ })
        }
      }
    }
    if (targets.length === 0) return null
    const run = makeRun(targets)
    if (!run) return null
    this.startRun(run, targets)
    return run
  }

  refsPresent(recordId: string, cfg: HttpColumnConfig): boolean {
    const nameToCol = this.nameToColumn(cfg.columnId)
    const templates = [cfg.urlTemplate, cfg.bodyTemplate]
    for (const tmpl of templates) {
      for (const tok of parseTemplate(tmpl)) {
        if (tok.kind !== 'ref') continue
        const v = this.resolveRef(recordId, tok.name, cfg.columnId, nameToCol)
        if (isEmptyInput(v ?? null)) return false
      }
    }
    return true
  }

  /** The resolved request URL for a row (secrets never appear in the URL). */
  resolvedUrlFor(recordId: string, cfg: HttpColumnConfig): string {
    const nameToCol = this.nameToColumn(cfg.columnId)
    return resolveTemplate(parseTemplate(cfg.urlTemplate), (name) =>
      this.resolveRef(recordId, name, cfg.columnId, nameToCol),
    ).text
  }

  /** True if a non-expired cache entry exists for this row (estimate: free). */
  cacheWarm(recordId: string, cfg: HttpColumnConfig): boolean {
    const nameToCol = this.nameToColumn(cfg.columnId)
    const resolve = (name: string) => this.resolveRef(recordId, name, cfg.columnId, nameToCol)
    const url = resolveTemplate(parseTemplate(cfg.urlTemplate), resolve)
    const body = resolveTemplate(parseTemplate(cfg.bodyTemplate), resolve)
    const cached = this.d.store.getHttpCacheEntry(buildHttpCacheKey(cfg.method, url.text, body.text))
    return !!cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())
  }

  // ---- resolution --------------------------------------------------------

  private resolveHttp(run: EnrichmentRun, t: HttpRunTarget): HttpOutcome | typeof PAUSE {
    const cfg = t.config
    const nameToCol = this.nameToColumn(cfg.columnId)
    const resolve = (name: string) => this.resolveRef(t.recordId, name, cfg.columnId, nameToCol)

    const url = resolveTemplate(parseTemplate(cfg.urlTemplate), resolve)
    const body = resolveTemplate(parseTemplate(cfg.bodyTemplate), resolve)
    const missing = [...url.missing, ...body.missing]
    if (missing.length > 0) {
      return { ...this.failureOutcome(`missing input: ${[...new Set(missing)].join(', ')}`), status: 'empty', method: cfg.method, requestUrl: url.text }
    }

    const cacheKey = buildHttpCacheKey(cfg.method, url.text, body.text)
    let responseJson: unknown
    let statusCode: number
    let fromCache = false
    let charged = 0
    let chargedUsd = 0

    const cached = run.forceFresh ? undefined : this.d.store.getHttpCacheEntry(cacheKey)
    if (cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())) {
      const p = cached.resultJson as { body?: unknown; statusCode?: number }
      responseJson = p?.body
      statusCode = p?.statusCode ?? 200
      fromCache = true
    } else {
      const call = mockHttpCall(cfg.method, url.text, body.text)
      statusCode = call.statusCode
      if (statusCode < 200 || statusCode >= 300) {
        // Non-2xx → Failed with the code (US-3.5). No charge for a failed call.
        return { status: 'failed', statusCode, method: cfg.method, credits: 0, providerCostUsd: 0, fromCache: false, reason: `HTTP ${statusCode} ${call.statusText}`, requestUrl: url.text, writes: [], fieldEmpties: [] }
      }
      responseJson = call.body
      if (!this.tryCharge(run, cfg.credits, cfg.providerCostUsd, `http:${hostOf(url.text)}:request`)) return PAUSE
      charged = cfg.credits
      chargedUsd = cfg.providerCostUsd
      this.d.store.putHttpCacheEntry({
        id: newId(),
        cacheKey,
        resultJson: { body: responseJson, statusCode },
        cost: chargedUsd,
        fetchedAt: this.d.now(),
        expiresAt: new Date(Date.parse(this.d.now()) + Math.max(0, cfg.cacheTtlDays) * 86400_000).toISOString(),
      })
    }

    // Map anchor value from responsePath.
    const writes: HttpWrite[] = []
    const fieldEmpties: HttpFieldEmpty[] = []
    const anchorCol = this.d.store.data.columns.find((c) => c.id === cfg.columnId)
    const anchorRaw = toCellValue(getJsonPath(responseJson, cfg.responsePath))
    if (anchorCol && !columnTypeRegistry[anchorCol.type].isEmpty(anchorRaw)) {
      const res = columnTypeRegistry[anchorCol.type].validate(anchorRaw, anchorCol.config)
      writes.push({ columnId: cfg.columnId, value: res.ok ? res.value : anchorRaw, fieldName: null })
    }

    // Fan-out mapping: field label → JSON path → destination column.
    for (const [field, path] of Object.entries(cfg.responseMapping)) {
      const destId = cfg.outputMapping[field]
      if (!destId) continue
      const dest = this.d.store.data.columns.find((c) => c.id === destId)
      if (!dest) continue
      const raw = toCellValue(getJsonPath(responseJson, path))
      if (columnTypeRegistry[dest.type].isEmpty(raw)) {
        fieldEmpties.push({ columnId: destId, fieldName: field, reason: `no value at ${path}` })
        continue
      }
      const res = columnTypeRegistry[dest.type].validate(raw, dest.config)
      if (res.ok && !columnTypeRegistry[dest.type].isEmpty(res.value)) {
        writes.push({ columnId: destId, value: res.value, fieldName: field })
      } else {
        fieldEmpties.push({ columnId: destId, fieldName: field, reason: res.ok ? 'empty' : res.error })
      }
    }

    const anyValue = writes.length > 0
    return {
      status: fromCache ? 'cached' : anyValue ? 'success' : 'empty',
      statusCode,
      method: cfg.method,
      credits: charged,
      providerCostUsd: chargedUsd,
      fromCache,
      reason: anyValue ? undefined : 'no mapped value in response',
      requestUrl: url.text,
      writes,
      fieldEmpties,
    }
  }

  // ---- reference resolution ----------------------------------------------

  private nameToColumn(anchorColumnId: string): Map<string, string> {
    const anchor = this.d.store.data.columns.find((c) => c.id === anchorColumnId)
    const tableId = anchor?.tableId
    const map = new Map<string, string>()
    for (const c of this.d.store.data.columns) {
      if (c.tableId === tableId) map.set(c.name.trim().toLowerCase(), c.id)
    }
    return map
  }

  private resolveRef(recordId: string, name: string, anchorColumnId: string, nameToCol: Map<string, string>): CellValue | undefined {
    const colId = nameToCol.get(name.trim().toLowerCase())
    if (!colId || colId === anchorColumnId) return undefined
    return this.d.store.getCell(recordId, colId)?.value ?? undefined
  }

  // ---- interim + terminal persistence ------------------------------------

  protected stampInterim(run: EnrichmentRun, t: HttpRunTarget, status: 'queued' | 'running'): void {
    const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
    const meta: HttpCellMeta = {
      status,
      runId: run.id,
      fieldName: null,
      method: t.config.method,
      statusCode: null,
      credits: 0,
      fromCache: false,
      fetchedAt: null,
      valueSource: 'provider',
    }
    const value = existing?.value ?? null
    this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), http: meta } })
    this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
  }

  protected applyTerminal(run: EnrichmentRun, t: HttpRunTarget, outcome: HttpOutcome): void {
    const ts = this.d.now()
    const metaFor = (fieldName: string | null, status: TerminalStatus, credits: number, reason?: string): HttpCellMeta => ({
      status,
      runId: run.id,
      fieldName,
      method: outcome.method,
      statusCode: outcome.statusCode,
      credits,
      fromCache: outcome.fromCache,
      reason,
      fetchedAt: ts,
      valueSource: outcome.fromCache ? 'cache' : 'provider',
    })

    const written = new Set<string>()
    for (const w of outcome.writes) {
      const existing = this.d.store.getCell(t.recordId, w.columnId)
      const meta = metaFor(w.fieldName ?? null, outcome.status, w.columnId === t.anchorColumnId ? outcome.credits : 0)
      this.d.store.setCell({ recordId: t.recordId, columnId: w.columnId, value: w.value, meta: { ...(existing?.meta ?? {}), http: meta } })
      written.add(w.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: w.columnId, meta, value: w.value })
    }
    for (const fe of outcome.fieldEmpties) {
      if (written.has(fe.columnId)) continue
      const existing = this.d.store.getCell(t.recordId, fe.columnId)
      const value = existing?.value ?? null
      const meta = metaFor(fe.fieldName, 'empty', 0, fe.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: fe.columnId, value, meta: { ...(existing?.meta ?? {}), http: meta } })
      written.add(fe.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: fe.columnId, meta, value })
    }
    if (!written.has(t.anchorColumnId)) {
      const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
      const value = existing?.value ?? null
      const meta = metaFor(null, outcome.status, outcome.credits, outcome.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), http: meta } })
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
    }

    this.d.store.data.httpResults.push({
      id: newId(),
      recordId: t.recordId,
      columnId: t.anchorColumnId,
      runId: run.id,
      operation: 'request',
      status: outcome.status,
      valueJson: this.d.store.getCell(t.recordId, t.anchorColumnId)?.value ?? null,
      method: outcome.method,
      requestUrl: outcome.requestUrl,
      statusCode: outcome.statusCode,
      credits: outcome.credits,
      providerCostUsd: outcome.providerCostUsd,
      fromCache: outcome.fromCache,
      reason: outcome.reason,
      fetchedAt: ts,
    } satisfies HttpCellResult)
  }
}

// ---------------------------------------------------------------------------
// Deterministic mock HTTP call
// ---------------------------------------------------------------------------

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(url.trim())
  return (m?.[1] ?? 'api').toLowerCase()
}

const COMPANY_WORDS = ['Northwind', 'Zephyr', 'Acme', 'Globex', 'Umbra', 'Vertex', 'Lumen', 'Cobalt', 'Sable', 'Onyx']
const CITIES = ['Austin', 'Denver', 'Berlin', 'Toronto', 'Singapore', 'Lisbon', 'Boston', 'Sydney']
const INDUSTRIES = ['SaaS', 'Fintech', 'Healthcare', 'Commerce', 'DevTools', 'AI/ML']

interface MockResponse {
  statusCode: number
  statusText: string
  body: unknown
}

/** A deterministic response for (method, url, body). ~90% 200s; the rest 4xx/5xx. */
function mockHttpCall(method: HttpMethod, url: string, body: string): MockResponse {
  const rng = mulberry32(hashString(`${method}|${url}|${body}`))
  const roll = frac(hashString(`${url}|status`))
  if (roll < 0.04) return { statusCode: 404, statusText: 'Not Found', body: { error: 'not found' } }
  if (roll < 0.06) return { statusCode: 500, statusText: 'Server Error', body: { error: 'internal error' } }
  if (roll < 0.07) return { statusCode: 429, statusText: 'Too Many Requests', body: { error: 'rate limited' } }

  const name = pick(rng, COMPANY_WORDS)
  const responseBody = {
    ok: true,
    data: {
      name,
      domain: `${name.toLowerCase()}.com`,
      city: pick(rng, CITIES),
      industry: pick(rng, INDUSTRIES),
      employees: 20 + Math.floor(rng() * 4800),
      revenueUsd: (1 + Math.floor(rng() * 90)) * 100000,
      founded: 2005 + Math.floor(rng() * 20),
      verified: rng() < 0.7,
    },
    results: [
      { title: `${name} — profile`, url: `https://${name.toLowerCase()}.com/about` },
      { title: `${name} — pricing`, url: `https://${name.toLowerCase()}.com/pricing` },
    ],
  }
  return { statusCode: 200, statusText: 'OK', body: responseBody }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T
}
