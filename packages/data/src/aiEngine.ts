// MockAiEngine — the Phase-3 AI-column resolver, running on the SHARED execution
// pipeline (OperationRunner). It reuses the exact six-state status machine,
// credit ledger, TTL cache, and per-cell provenance as enrichment; only the
// per-cell resolution differs: substitute {{Column}} references into the prompt
// (FR-3.3), simulate a deterministic LLM generation, optionally validate a
// structured-output schema (FR-3.2), and coerce results into typed cells.
//
// Determinism: generations are seeded from the model, operation, resolved prompt
// and schema hash, so re-runs are stable and cache hits are byte-identical.

import type {
  AiCellMeta,
  AiCellResult,
  AiColumnConfig,
  AiModelInfo,
  AiOperation,
  AiOutputField,
  CellValue,
  ColumnConfig,
  ColumnType,
  EnrichmentRun,
} from '@cascade/core'
import {
  columnTypeRegistry,
  defaultConfigFor,
  newId,
  parseTemplate,
  repairStructured,
  resolveTemplate,
  validateStructured,
} from '@cascade/core'
import type { AiEvent } from './api'
import { isEmptyInput } from './enrichmentEngine'
import { frac, hashString, mulberry32, OperationRunner, PAUSE, snapshotRun } from './operationRunner'
import type { OpEngineDeps, OpTarget, TerminalStatus } from './operationRunner'
import { resolveAiModel } from './aiModels'

export type AiEngineDeps = OpEngineDeps<AiEvent>

/** One (record × ai column) unit of work in an AI run. */
export interface AiRunTarget extends OpTarget {
  config: AiColumnConfig
}

const MAX_RETRIES = 2
const TRANSIENT_RATE = 0.05
const RATE_LIMIT_RATE = 0.02

// Per-operation probability the model returns nothing usable.
const EMPTY_RATE: Record<AiOperation, number> = {
  summarize: 0.03,
  classify: 0.05,
  extract: 0.12,
  generate: 0.05,
}

// ---------------------------------------------------------------------------
// Cache key (exported so estimate can recognise a warm cache the same way)
// ---------------------------------------------------------------------------

/** Collapse whitespace but preserve case — distinct prompts stay distinct. */
export function normalizeResolvedPrompt(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** A stable fingerprint of the output schema, shared by the cache key and the
 * generation seed so the two never drift. Two AI columns with the same model,
 * operation and resolved prompt but DIFFERENT schemas must not collide in the
 * cache (US-3.2) — they'd serve each other's structured payload. */
export function schemaFingerprint(schema: AiOutputField[]): string {
  return hashString(JSON.stringify(schema.map((f) => `${f.name}:${f.type}`))).toString(36)
}

export function buildAiCacheKey(modelKey: string, op: AiOperation, resolvedPrompt: string, schema: AiOutputField[] = []): string {
  return `${modelKey}|${op}|${schemaFingerprint(schema)}|${normalizeResolvedPrompt(resolvedPrompt)}`
}

// ---------------------------------------------------------------------------
// Outcome of resolving one AI cell
// ---------------------------------------------------------------------------

interface AiWrite {
  columnId: string
  value: CellValue
  fieldName?: string | null
}

interface AiFieldEmpty {
  columnId: string
  fieldName: string
  reason: string
}

interface AiOutcome {
  status: TerminalStatus
  modelKey: string | null
  operation: AiOperation | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  confidence: number | null
  reason?: string
  promptResolved?: string
  /** Anchor primary text + accepted structured-field writes. */
  writes: AiWrite[]
  /** Structured fields that could not be produced → per-field Empty (US-3.2). */
  fieldEmpties: AiFieldEmpty[]
}

type AiGen =
  | { empty: true }
  | { empty: false; text: string; structured: unknown; confidence: number }

interface AiCall {
  hardFail?: boolean
  reason?: string
  gen?: AiGen
}

export class MockAiEngine extends OperationRunner<AiRunTarget, AiOutcome, AiEvent> {
  constructor(d: AiEngineDeps) {
    super(d)
  }

  // ---- per-operation hooks (see OperationRunner) -------------------------

  protected resolve(run: EnrichmentRun, t: AiRunTarget): AiOutcome | typeof PAUSE {
    return this.resolveAi(run, t)
  }

  protected failureOutcome(reason: string): AiOutcome {
    return { status: 'failed', modelKey: null, operation: null, credits: 0, providerCostUsd: 0, fromCache: false, confidence: null, reason, writes: [], fieldEmpties: [] }
  }

  protected emitRun(run: EnrichmentRun): void {
    this.d.emit({ type: 'run', run: snapshotRun(run) })
  }

  protected emitBudget(workspaceId: string, balance: number, paused: boolean): void {
    this.d.emit({ type: 'budget', workspaceId, balance, paused })
  }

  protected runsList(): EnrichmentRun[] {
    return this.d.store.data.aiRuns
  }

  protected cellMetaKey(): 'ai' {
    return 'ai'
  }

  // ---- public API --------------------------------------------------------

  /** Flip orphaned in-flight AI cells + runs to Failed on load. */
  reconcileOnLoad(): void {
    this.reconcile()
  }

  /**
   * Auto-run AI columns for freshly-added rows on configs with autoRun enabled
   * and all referenced inputs present (parity with enrichment auto-run).
   */
  autoRun(
    tableId: string,
    recordIds: string[],
    makeRun: (targets: AiRunTarget[]) => EnrichmentRun | null,
  ): EnrichmentRun | null {
    const configs = this.d.store.getAiConfigsForTable(tableId).filter((c) => c.autoRun)
    if (configs.length === 0) return null
    const targets: AiRunTarget[] = []
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

  /** True when every {{reference}} in the prompt resolves to a non-blank cell. */
  refsPresent(recordId: string, cfg: AiColumnConfig): boolean {
    const nameToCol = this.nameToColumn(cfg.columnId)
    for (const tok of parseTemplate(cfg.promptTemplate)) {
      if (tok.kind !== 'ref') continue
      const v = this.resolveRef(recordId, tok.name, cfg.columnId, nameToCol)
      if (isEmptyInput(v ?? null)) return false
    }
    return true
  }

  /** The prompt with {{references}} substituted for a row (for estimate cache keys). */
  resolvedPromptFor(recordId: string, cfg: AiColumnConfig): string {
    const nameToCol = this.nameToColumn(cfg.columnId)
    const { text } = resolveTemplate(parseTemplate(cfg.promptTemplate), (name) =>
      this.resolveRef(recordId, name, cfg.columnId, nameToCol),
    )
    return text
  }

  // ---- resolution --------------------------------------------------------

  private resolveAi(run: EnrichmentRun, t: AiRunTarget): AiOutcome | typeof PAUSE {
    const cfg = t.config
    const modelInfo = resolveAiModel(cfg.model)
    if (!modelInfo) {
      return { ...this.failureOutcome(`unknown model: ${cfg.model.model}`), operation: cfg.operation }
    }
    const modelKey = modelInfo.key
    const op = cfg.operation

    // 1) Substitute {{Column}} references (FR-3.3).
    const nameToCol = this.nameToColumn(cfg.columnId)
    const tokens = parseTemplate(cfg.promptTemplate)
    const { text: resolvedPrompt, missing } = resolveTemplate(tokens, (name) =>
      this.resolveRef(t.recordId, name, cfg.columnId, nameToCol),
    )
    if (missing.length > 0) {
      // Missing referenced inputs → Empty, no charge (US-3.1).
      return { status: 'empty', modelKey, operation: op, credits: 0, providerCostUsd: 0, fromCache: false, confidence: null, reason: `missing input: ${missing.join(', ')}`, promptResolved: resolvedPrompt, writes: [], fieldEmpties: [] }
    }

    // 2) Cache lookup (free) unless the run forces a fresh generation.
    const cacheKey = buildAiCacheKey(modelKey, op, resolvedPrompt, cfg.outputSchema)
    let gen: Exclude<AiGen, { empty: true }> | null = null
    let fromCache = false
    let charged = 0
    let chargedUsd = 0

    const cached = run.forceFresh ? undefined : this.d.store.getAiCacheEntry(cacheKey)
    if (cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())) {
      const payload = cached.resultJson as { text?: string; structured?: unknown; confidence?: number }
      gen = { empty: false, text: payload?.text ?? '', structured: payload?.structured ?? {}, confidence: payload?.confidence ?? 0.8 }
      fromCache = true
    } else {
      const call = this.callModel(modelInfo, op, resolvedPrompt, cfg.outputSchema)
      if (call.hardFail) {
        return { status: 'failed', modelKey, operation: op, credits: 0, providerCostUsd: 0, fromCache: false, confidence: null, reason: call.reason, promptResolved: resolvedPrompt, writes: [], fieldEmpties: [] }
      }
      if (!call.gen || call.gen.empty) {
        return { status: 'empty', modelKey, operation: op, credits: 0, providerCostUsd: 0, fromCache: false, confidence: null, reason: 'no result', promptResolved: resolvedPrompt, writes: [], fieldEmpties: [] }
      }
      // A real generation — charge atomically before accepting.
      if (!this.tryCharge(run, cfg.credits, cfg.providerCostUsd, `ai:${modelKey}:${op}`)) {
        return PAUSE
      }
      charged = cfg.credits
      chargedUsd = cfg.providerCostUsd
      gen = call.gen
      this.d.store.putAiCacheEntry({
        id: newId(),
        cacheKey,
        modelKey,
        operation: op,
        resultJson: { text: gen.text, structured: gen.structured, confidence: gen.confidence },
        cost: chargedUsd,
        fetchedAt: this.d.now(),
        // Clamp the TTL to a finite, sane range so a malformed cacheTtlDays
        // (NaN / Infinity / absurdly large) can't produce an Invalid Date whose
        // toISOString() throws AFTER the cell was charged (orphaning credits).
        expiresAt: new Date(Date.parse(this.d.now()) + safeTtlDays(cfg.cacheTtlDays) * 86400_000).toISOString(),
      })
    }

    // 3) Build cell writes.
    const writes: AiWrite[] = []
    const fieldEmpties: AiFieldEmpty[] = []

    // Anchor primary text — only written if it validates against the anchor's
    // type. Never write the raw model text into a typed cell (US-3.2 "not written
    // raw"); a non-validating result leaves the prior value.
    const anchorCol = this.d.store.data.columns.find((c) => c.id === cfg.columnId)
    if (anchorCol && gen.text) {
      const res = columnTypeRegistry[anchorCol.type].validate(gen.text, anchorCol.config)
      if (res.ok && !columnTypeRegistry[anchorCol.type].isEmpty(res.value)) {
        writes.push({ columnId: cfg.columnId, value: res.value, fieldName: null })
      }
    }

    // Structured output → destination columns (US-3.2).
    if (cfg.outputSchema.length > 0) {
      const obj = repairStructured(gen.structured) ?? gen.structured
      // Coerce each field against the DESTINATION column's actual type + config,
      // not the schema field's declared type — they can diverge (US-3.2).
      const sv = validateStructured(obj, cfg.outputSchema, (f) => this.destColConfig(cfg, f), (f) => this.destColType(cfg, f))
      for (const field of cfg.outputSchema) {
        const destId = cfg.outputMapping[field.name]
        if (!destId) continue
        const dest = this.d.store.data.columns.find((c) => c.id === destId)
        if (!dest) continue
        const fv = sv.fields[field.name]
        if (fv?.ok && fv.value !== undefined && !columnTypeRegistry[dest.type].isEmpty(fv.value)) {
          writes.push({ columnId: destId, value: fv.value, fieldName: field.name })
        } else {
          fieldEmpties.push({ columnId: destId, fieldName: field.name, reason: fv?.reason ?? 'no value' })
        }
      }
    }

    return {
      status: fromCache ? 'cached' : 'success',
      modelKey,
      operation: op,
      credits: charged,
      providerCostUsd: chargedUsd,
      fromCache,
      confidence: gen.confidence,
      promptResolved: resolvedPrompt,
      writes,
      fieldEmpties,
    }
  }

  private callModel(model: AiModelInfo, op: AiOperation, resolvedPrompt: string, schema: AiOutputField[]): AiCall {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const transientRoll = frac(hashString(`${resolvedPrompt}|t|${attempt}|${op}`))
      if (transientRoll < TRANSIENT_RATE) {
        const kind = transientRoll < RATE_LIMIT_RATE ? 'rate limited (429)' : 'model timeout'
        if (attempt < MAX_RETRIES) continue // backoff & retry
        return { hardFail: true, reason: `${kind} · retried ×${MAX_RETRIES}` }
      }
      return { gen: generateAi(model, op, resolvedPrompt, schema) }
    }
    /* c8 ignore next */
    return { gen: { empty: true } }
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

  /** Resolve a {{Name}} reference to a cell value; undefined if unknown/self/blank. */
  private resolveRef(recordId: string, name: string, anchorColumnId: string, nameToCol: Map<string, string>): CellValue | undefined {
    const colId = nameToCol.get(name.trim().toLowerCase())
    // Unknown column, or a self-reference (would create a feedback loop) → missing.
    if (!colId || colId === anchorColumnId) return undefined
    return this.d.store.getCell(recordId, colId)?.value ?? undefined
  }

  private destColConfig(cfg: AiColumnConfig, field: AiOutputField): ColumnConfig {
    const destId = cfg.outputMapping[field.name]
    const dest = destId ? this.d.store.data.columns.find((c) => c.id === destId) : undefined
    return dest?.config ?? defaultConfigFor(field.type)
  }

  /** The destination column's type (falls back to the field's declared type when
   * the field has no mapped destination). Keeps structured coercion in sync with
   * where the value actually lands. */
  private destColType(cfg: AiColumnConfig, field: AiOutputField): ColumnType {
    const destId = cfg.outputMapping[field.name]
    const dest = destId ? this.d.store.data.columns.find((c) => c.id === destId) : undefined
    return dest?.type ?? field.type
  }

  // ---- interim + terminal persistence ------------------------------------

  protected stampInterim(run: EnrichmentRun, t: AiRunTarget, status: 'queued' | 'running'): void {
    const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
    const modelInfo = resolveAiModel(t.config.model)
    const meta: AiCellMeta = {
      status,
      modelKey: modelInfo?.key ?? null,
      operation: t.config.operation,
      runId: run.id,
      fieldName: null,
      confidence: null,
      credits: 0,
      fromCache: false,
      fetchedAt: null,
      valueSource: 'provider',
    }
    const value = existing?.value ?? null
    this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), ai: meta } })
    this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
  }

  protected applyTerminal(run: EnrichmentRun, t: AiRunTarget, outcome: AiOutcome): void {
    const ts = this.d.now()
    const metaFor = (fieldName: string | null, status: TerminalStatus, credits: number, reason?: string): AiCellMeta => ({
      status,
      modelKey: outcome.modelKey,
      operation: outcome.operation,
      runId: run.id,
      fieldName,
      confidence: outcome.confidence,
      credits,
      fromCache: outcome.fromCache,
      reason,
      fetchedAt: ts,
      valueSource: outcome.fromCache ? 'cache' : 'provider',
    })

    const written = new Set<string>()
    // Accepted writes (anchor text + structured fields).
    for (const w of outcome.writes) {
      const existing = this.d.store.getCell(t.recordId, w.columnId)
      const meta = metaFor(w.fieldName ?? null, outcome.status, w.columnId === t.anchorColumnId ? outcome.credits : 0)
      this.d.store.setCell({ recordId: t.recordId, columnId: w.columnId, value: w.value, meta: { ...(existing?.meta ?? {}), ai: meta } })
      written.add(w.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: w.columnId, meta, value: w.value })
    }
    // Per-field Empties (US-3.2): valid fields still populated; these did not.
    for (const fe of outcome.fieldEmpties) {
      if (written.has(fe.columnId)) continue
      const existing = this.d.store.getCell(t.recordId, fe.columnId)
      const value = existing?.value ?? null
      const meta = metaFor(fe.fieldName, 'empty', 0, fe.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: fe.columnId, value, meta: { ...(existing?.meta ?? {}), ai: meta } })
      written.add(fe.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: fe.columnId, meta, value })
    }
    // Always stamp the anchor's status even with no write, keeping any prior value.
    if (!written.has(t.anchorColumnId)) {
      const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
      const value = existing?.value ?? null
      const meta = metaFor(null, outcome.status, outcome.credits, outcome.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), ai: meta } })
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
    }

    this.d.store.data.aiResults.push({
      id: newId(),
      recordId: t.recordId,
      columnId: t.anchorColumnId,
      runId: run.id,
      modelKey: outcome.modelKey,
      operation: outcome.operation,
      status: outcome.status,
      valueJson: this.d.store.getCell(t.recordId, t.anchorColumnId)?.value ?? null,
      promptResolved: outcome.promptResolved,
      confidence: outcome.confidence,
      credits: outcome.credits,
      providerCostUsd: outcome.providerCostUsd,
      fromCache: outcome.fromCache,
      reason: outcome.reason,
      fetchedAt: ts,
    } satisfies AiCellResult)
  }
}

// ---------------------------------------------------------------------------
// Deterministic mock generation
// ---------------------------------------------------------------------------

const PITCH_ADJ = ['AI-native', 'operator-first', 'developer-friendly', 'enterprise-grade', 'lightweight', 'end-to-end', 'data-driven', 'purpose-built']
const PITCH_CATEGORY = ['GTM platform', 'data-enrichment engine', 'revenue-intelligence suite', 'workflow automation tool', 'sales-ops platform', 'analytics layer', 'CRM companion', 'prospecting workspace']
const PITCH_VALUE = ['turns raw signals into pipeline', 'helps teams close faster', 'automates the busywork', 'unifies scattered data', 'surfaces the next best action', 'keeps records fresh automatically', 'scales outreach without the noise']
const INDUSTRIES = ['SaaS', 'Fintech', 'Healthcare', 'Commerce', 'DevTools', 'AI/ML', 'Logistics', 'Marketing']
const FIRST_NAMES = ['jordan', 'rosa', 'marco', 'priya', 'sam', 'lena', 'omar', 'nina', 'diego', 'ava', 'theo', 'mira']
const LAST_NAMES = ['okoye', 'nair', 'klein', 'advani', 'reyes', 'baxter', 'nomura', 'silva', 'khan', 'foster', 'ionescu', 'park']

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T
}

/** Clamp a config's cache TTL to a finite, sane day range (0..3650). */
function safeTtlDays(days: number): number {
  return Math.min(3650, Number.isFinite(days) ? Math.max(0, days) : 30)
}

function generateAi(model: AiModelInfo, op: AiOperation, resolvedPrompt: string, schema: AiOutputField[]): AiGen {
  const normalized = normalizeResolvedPrompt(resolvedPrompt)
  const rng = mulberry32(hashString(`${model.key}|${op}|${normalized}|${schemaFingerprint(schema)}`))
  if (rng() < (EMPTY_RATE[op] ?? 0.05)) return { empty: true }

  let text: string
  switch (op) {
    case 'summarize':
      text = `${pick(rng, PITCH_ADJ)} ${pick(rng, PITCH_CATEGORY)} that ${pick(rng, PITCH_VALUE)}.`
      break
    case 'classify':
      text = pick(rng, INDUSTRIES)
      break
    case 'extract':
      text = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`.replace(/\b\w/g, (c) => c.toUpperCase())
      break
    case 'generate':
    default:
      text = `${pick(rng, PITCH_ADJ)} approach — ${pick(rng, PITCH_VALUE)}.`
      break
  }

  const structured = schema.length > 0 ? buildStructured(rng, schema) : {}
  const confidence = Math.round((0.6 + rng() * 0.38) * 100) / 100
  // ~8% of the time emit the structured payload as fenced JSON to exercise the
  // repair path (validateStructured + repairStructured).
  const emitFenced = schema.length > 0 && rng() < 0.08
  return {
    empty: false,
    text,
    structured: emitFenced ? '```json\n' + JSON.stringify(structured) + '\n```' : structured,
    confidence,
  }
}

function buildStructured(rng: () => number, schema: AiOutputField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema) {
    // ~8% chance to omit a field so per-field Empty is exercised (US-3.2).
    if (rng() < 0.08) continue
    out[field.name] = valueForType(rng, field.type)
  }
  return out
}

function valueForType(rng: () => number, type: AiOutputField['type']): unknown {
  switch (type) {
    case 'number':
    case 'currency':
      return 1 + Math.floor(rng() * 9999)
    case 'boolean':
      return rng() < 0.5
    case 'date': {
      const y = 2024 + Math.floor(rng() * 3)
      const m = 1 + Math.floor(rng() * 12)
      const d = 1 + Math.floor(rng() * 28)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    case 'url':
      return `https://${pick(rng, LAST_NAMES)}.com`
    case 'email':
      return `${pick(rng, FIRST_NAMES)}.${pick(rng, LAST_NAMES)}@${pick(rng, LAST_NAMES)}.com`
    case 'phone':
      return `+1 ${200 + Math.floor(rng() * 799)} 555 ${String(Math.floor(rng() * 10000)).padStart(4, '0')}`
    default:
      return `${pick(rng, PITCH_ADJ)} ${pick(rng, INDUSTRIES)}`
  }
}
