// MockAgentEngine — the Phase-3 web-research agent resolver (US-3.3/3.4), on the
// SHARED execution pipeline (OperationRunner). It mirrors MockAiEngine: it
// substitutes {{Column}} references into the research objective (FR-3.3), then
// simulates a bounded multi-step browse (up to maxSteps / maxPages), synthesises
// an answer, optionally fans out a structured schema (FR-3.2), and — the one new
// surface — CITES the sources it "visited" (US-3.4). Determinism is seeded from
// the model, objective and schema so re-runs and cache hits are byte-identical.

import type {
  AgentCellMeta,
  AgentCellResult,
  AgentColumnConfig,
  AgentSource,
  AiModelInfo,
  AiOutputField,
  CellValue,
  ColumnConfig,
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
import type { AgentEvent } from './api'
import { isEmptyInput } from './enrichmentEngine'
import { frac, hashString, mulberry32, OperationRunner, PAUSE, snapshotRun } from './operationRunner'
import type { OpEngineDeps, OpTarget, TerminalStatus } from './operationRunner'
import { resolveAiModel } from './aiModels'

export type AgentEngineDeps = OpEngineDeps<AgentEvent>

/** One (record × agent column) unit of work in an agent run. */
export interface AgentRunTarget extends OpTarget {
  config: AgentColumnConfig
}

const MAX_RETRIES = 2
const TRANSIENT_RATE = 0.05
const RATE_LIMIT_RATE = 0.02
const EMPTY_RATE = 0.08 // the web sometimes yields nothing usable

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

export function normalizeObjective(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

export function buildAgentCacheKey(modelKey: string, resolvedObjective: string): string {
  return `${modelKey}|research|${normalizeObjective(resolvedObjective)}`
}

// ---------------------------------------------------------------------------
// Outcome of resolving one agent cell
// ---------------------------------------------------------------------------

interface AgentWrite {
  columnId: string
  value: CellValue
  fieldName?: string | null
}
interface AgentFieldEmpty {
  columnId: string
  fieldName: string
  reason: string
}
interface AgentOutcome {
  status: TerminalStatus
  modelKey: string | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  confidence: number | null
  reason?: string
  objectiveResolved?: string
  sources: AgentSource[]
  steps: number
  pages: number
  writes: AgentWrite[]
  fieldEmpties: AgentFieldEmpty[]
}

type AgentGen =
  | { empty: true }
  | { empty: false; text: string; structured: unknown; sources: AgentSource[]; steps: number; pages: number; confidence: number }

interface AgentCall {
  hardFail?: boolean
  reason?: string
  gen?: AgentGen
}

export class MockAgentEngine extends OperationRunner<AgentRunTarget, AgentOutcome, AgentEvent> {
  constructor(d: AgentEngineDeps) {
    super(d)
  }

  // ---- per-operation hooks ----------------------------------------------

  protected resolve(run: EnrichmentRun, t: AgentRunTarget): AgentOutcome | typeof PAUSE {
    return this.resolveAgent(run, t)
  }

  protected failureOutcome(reason: string): AgentOutcome {
    return { status: 'failed', modelKey: null, credits: 0, providerCostUsd: 0, fromCache: false, confidence: null, reason, sources: [], steps: 0, pages: 0, writes: [], fieldEmpties: [] }
  }

  protected emitRun(run: EnrichmentRun): void {
    this.d.emit({ type: 'run', run: snapshotRun(run) })
  }

  protected emitBudget(workspaceId: string, balance: number, paused: boolean): void {
    this.d.emit({ type: 'budget', workspaceId, balance, paused })
  }

  protected runsList(): EnrichmentRun[] {
    return this.d.store.data.agentRuns
  }

  protected cellMetaKey(): 'agent' {
    return 'agent'
  }

  // ---- public API --------------------------------------------------------

  reconcileOnLoad(): void {
    this.reconcile()
  }

  autoRun(
    tableId: string,
    recordIds: string[],
    makeRun: (targets: AgentRunTarget[]) => EnrichmentRun | null,
  ): EnrichmentRun | null {
    const configs = this.d.store.getAgentConfigsForTable(tableId).filter((c) => c.autoRun)
    if (configs.length === 0) return null
    const targets: AgentRunTarget[] = []
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

  refsPresent(recordId: string, cfg: AgentColumnConfig): boolean {
    const nameToCol = this.nameToColumn(cfg.columnId)
    for (const tok of parseTemplate(cfg.objective)) {
      if (tok.kind !== 'ref') continue
      const v = this.resolveRef(recordId, tok.name, cfg.columnId, nameToCol)
      if (isEmptyInput(v ?? null)) return false
    }
    return true
  }

  resolvedObjectiveFor(recordId: string, cfg: AgentColumnConfig): string {
    const nameToCol = this.nameToColumn(cfg.columnId)
    const { text } = resolveTemplate(parseTemplate(cfg.objective), (name) =>
      this.resolveRef(recordId, name, cfg.columnId, nameToCol),
    )
    return text
  }

  /** True if a non-expired cache entry exists for this row (estimate: free). */
  cacheWarm(recordId: string, cfg: AgentColumnConfig): boolean {
    const modelInfo = resolveAiModel(cfg.model)
    if (!modelInfo) return false
    const cached = this.d.store.getAgentCacheEntry(buildAgentCacheKey(modelInfo.key, this.resolvedObjectiveFor(recordId, cfg)))
    return !!cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())
  }

  // ---- resolution --------------------------------------------------------

  private resolveAgent(run: EnrichmentRun, t: AgentRunTarget): AgentOutcome | typeof PAUSE {
    const cfg = t.config
    const modelInfo = resolveAiModel(cfg.model)
    if (!modelInfo) return this.failureOutcome(`unknown model: ${cfg.model.model}`)
    const modelKey = modelInfo.key

    // 1) Substitute {{Column}} references.
    const nameToCol = this.nameToColumn(cfg.columnId)
    const tokens = parseTemplate(cfg.objective)
    const { text: resolvedObjective, missing } = resolveTemplate(tokens, (name) =>
      this.resolveRef(t.recordId, name, cfg.columnId, nameToCol),
    )
    if (missing.length > 0) {
      return { ...this.failureOutcome(''), status: 'empty', modelKey, reason: `missing input: ${missing.join(', ')}`, objectiveResolved: resolvedObjective }
    }

    // 2) Cache lookup (free) unless forced fresh.
    const cacheKey = buildAgentCacheKey(modelKey, resolvedObjective)
    let gen: Exclude<AgentGen, { empty: true }> | null = null
    let fromCache = false
    let charged = 0
    let chargedUsd = 0

    const cached = run.forceFresh ? undefined : this.d.store.getAgentCacheEntry(cacheKey)
    if (cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())) {
      const p = cached.resultJson as { text?: string; structured?: unknown; sources?: AgentSource[]; steps?: number; pages?: number; confidence?: number }
      gen = { empty: false, text: p?.text ?? '', structured: p?.structured ?? {}, sources: p?.sources ?? [], steps: p?.steps ?? 0, pages: p?.pages ?? 0, confidence: p?.confidence ?? 0.8 }
      fromCache = true
    } else {
      const call = this.callAgent(modelInfo, resolvedObjective, cfg)
      if (call.hardFail) {
        return { ...this.failureOutcome(call.reason ?? 'agent failed'), modelKey, objectiveResolved: resolvedObjective }
      }
      if (!call.gen || call.gen.empty) {
        return { ...this.failureOutcome(''), status: 'empty', modelKey, reason: 'no result found', objectiveResolved: resolvedObjective }
      }
      if (!this.tryCharge(run, cfg.credits, cfg.providerCostUsd, `agent:${modelKey}:research`)) return PAUSE
      charged = cfg.credits
      chargedUsd = cfg.providerCostUsd
      gen = call.gen
      this.d.store.putAgentCacheEntry({
        id: newId(),
        cacheKey,
        modelKey,
        resultJson: { text: gen.text, structured: gen.structured, sources: gen.sources, steps: gen.steps, pages: gen.pages, confidence: gen.confidence },
        cost: chargedUsd,
        fetchedAt: this.d.now(),
        expiresAt: new Date(Date.parse(this.d.now()) + Math.max(0, cfg.cacheTtlDays) * 86400_000).toISOString(),
      })
    }

    // 3) Build cell writes.
    const writes: AgentWrite[] = []
    const fieldEmpties: AgentFieldEmpty[] = []

    const anchorCol = this.d.store.data.columns.find((c) => c.id === cfg.columnId)
    if (anchorCol && gen.text) {
      const res = columnTypeRegistry[anchorCol.type].validate(gen.text, anchorCol.config)
      const value = res.ok ? res.value : gen.text
      if (!columnTypeRegistry[anchorCol.type].isEmpty(value)) writes.push({ columnId: cfg.columnId, value, fieldName: null })
    }

    if (cfg.outputSchema.length > 0) {
      const obj = repairStructured(gen.structured) ?? gen.structured
      const sv = validateStructured(obj, cfg.outputSchema, (f) => this.destColConfig(cfg, f))
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
      credits: charged,
      providerCostUsd: chargedUsd,
      fromCache,
      confidence: gen.confidence,
      objectiveResolved: resolvedObjective,
      sources: gen.sources,
      steps: gen.steps,
      pages: gen.pages,
      writes,
      fieldEmpties,
    }
  }

  private callAgent(model: AiModelInfo, resolvedObjective: string, cfg: AgentColumnConfig): AgentCall {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const transientRoll = frac(hashString(`${resolvedObjective}|t|${attempt}|agent`))
      if (transientRoll < TRANSIENT_RATE) {
        const kind = transientRoll < RATE_LIMIT_RATE ? 'search rate limited (429)' : 'browse timeout'
        if (attempt < MAX_RETRIES) continue
        return { hardFail: true, reason: `${kind} · retried ×${MAX_RETRIES}` }
      }
      return { gen: generateAgent(model, resolvedObjective, cfg) }
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

  private resolveRef(recordId: string, name: string, anchorColumnId: string, nameToCol: Map<string, string>): CellValue | undefined {
    const colId = nameToCol.get(name.trim().toLowerCase())
    if (!colId || colId === anchorColumnId) return undefined
    return this.d.store.getCell(recordId, colId)?.value ?? undefined
  }

  private destColConfig(cfg: AgentColumnConfig, field: AiOutputField): ColumnConfig {
    const destId = cfg.outputMapping[field.name]
    const dest = destId ? this.d.store.data.columns.find((c) => c.id === destId) : undefined
    return dest?.config ?? defaultConfigFor(field.type)
  }

  // ---- interim + terminal persistence ------------------------------------

  protected stampInterim(run: EnrichmentRun, t: AgentRunTarget, status: 'queued' | 'running'): void {
    const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
    const modelInfo = resolveAiModel(t.config.model)
    const meta: AgentCellMeta = {
      status,
      modelKey: modelInfo?.key ?? null,
      runId: run.id,
      fieldName: null,
      confidence: null,
      credits: 0,
      fromCache: false,
      fetchedAt: null,
      valueSource: 'provider',
    }
    const value = existing?.value ?? null
    this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), agent: meta } })
    this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
  }

  protected applyTerminal(run: EnrichmentRun, t: AgentRunTarget, outcome: AgentOutcome): void {
    const ts = this.d.now()
    const metaFor = (fieldName: string | null, status: TerminalStatus, credits: number, reason?: string): AgentCellMeta => ({
      status,
      modelKey: outcome.modelKey,
      runId: run.id,
      fieldName,
      steps: outcome.steps,
      pages: outcome.pages,
      sourceCount: outcome.sources.length,
      confidence: outcome.confidence,
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
      this.d.store.setCell({ recordId: t.recordId, columnId: w.columnId, value: w.value, meta: { ...(existing?.meta ?? {}), agent: meta } })
      written.add(w.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: w.columnId, meta, value: w.value })
    }
    for (const fe of outcome.fieldEmpties) {
      if (written.has(fe.columnId)) continue
      const existing = this.d.store.getCell(t.recordId, fe.columnId)
      const value = existing?.value ?? null
      const meta = metaFor(fe.fieldName, 'empty', 0, fe.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: fe.columnId, value, meta: { ...(existing?.meta ?? {}), agent: meta } })
      written.add(fe.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: fe.columnId, meta, value })
    }
    if (!written.has(t.anchorColumnId)) {
      const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
      const value = existing?.value ?? null
      const meta = metaFor(null, outcome.status, outcome.credits, outcome.reason)
      this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), agent: meta } })
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
    }

    this.d.store.data.agentResults.push({
      id: newId(),
      recordId: t.recordId,
      columnId: t.anchorColumnId,
      runId: run.id,
      modelKey: outcome.modelKey,
      operation: 'research',
      status: outcome.status,
      valueJson: this.d.store.getCell(t.recordId, t.anchorColumnId)?.value ?? null,
      objectiveResolved: outcome.objectiveResolved,
      sources: outcome.sources,
      steps: outcome.steps,
      pages: outcome.pages,
      confidence: outcome.confidence,
      credits: outcome.credits,
      providerCostUsd: outcome.providerCostUsd,
      fromCache: outcome.fromCache,
      reason: outcome.reason,
      fetchedAt: ts,
    } satisfies AgentCellResult)
  }
}

// ---------------------------------------------------------------------------
// Deterministic mock research
// ---------------------------------------------------------------------------

const FINDINGS = ['Series B, $42M raised', 'HQ in Austin, TX', '~340 employees', 'founded 2019', 'expanding into EMEA', 'recently launched an API', 'profitable since 2023', 'backed by a16z', 'hiring across GTM', 'strong developer community']
const DOMAINS = ['techcrunch.com', 'crunchbase.com', 'linkedin.com', 'g2.com', 'bloomberg.com', 'sec.gov', 'wikipedia.org', 'ycombinator.com']
const TITLES = ['Company profile', 'Funding announcement', 'Team page', 'Product overview', 'Press release', 'Market analysis', 'About us', 'News coverage']
const INDUSTRIES = ['SaaS', 'Fintech', 'Healthcare', 'Commerce', 'DevTools', 'AI/ML', 'Logistics', 'Marketing']
const FIRST_NAMES = ['jordan', 'rosa', 'marco', 'priya', 'sam', 'lena', 'omar', 'nina']
const LAST_NAMES = ['okoye', 'nair', 'klein', 'advani', 'reyes', 'baxter', 'nomura', 'silva']

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T
}

function slug(objective: string): string {
  const words = normalizeObjective(objective).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 3)
  return words.join('-') || 'research'
}

function generateAgent(model: AiModelInfo, resolvedObjective: string, cfg: AgentColumnConfig): AgentGen {
  const normalized = normalizeObjective(resolvedObjective)
  const schemaHash = hashString(JSON.stringify(cfg.outputSchema.map((f) => `${f.name}:${f.type}`)))
  const rng = mulberry32(hashString(`${model.key}|research|${normalized}|${schemaHash}`))
  if (rng() < EMPTY_RATE) return { empty: true }

  // A bounded browse: pick how many pages (capped) and derive steps.
  const maxPages = Math.max(1, cfg.maxPages)
  const maxSteps = Math.max(1, cfg.maxSteps)
  const pages = 1 + Math.floor(rng() * Math.min(maxPages, 4))
  const steps = Math.min(maxSteps, pages + 1 + Math.floor(rng() * 2))

  const sources: AgentSource[] = []
  const usedDomains = new Set<string>()
  for (let i = 0; i < pages; i++) {
    let domain = pick(rng, DOMAINS)
    let guard = 0
    while (usedDomains.has(domain) && guard++ < 4) domain = pick(rng, DOMAINS)
    usedDomains.add(domain)
    sources.push({
      url: `https://${domain}/${slug(resolvedObjective)}`,
      title: pick(rng, TITLES),
      snippet: pick(rng, FINDINGS),
    })
  }

  const finding = pick(rng, FINDINGS)
  const text = `Based on ${pages} source${pages > 1 ? 's' : ''}: ${finding}.`
  const structured = cfg.outputSchema.length > 0 ? buildStructured(rng, cfg.outputSchema) : {}
  const confidence = Math.round((0.55 + rng() * 0.4) * 100) / 100
  const emitFenced = cfg.outputSchema.length > 0 && rng() < 0.08
  return {
    empty: false,
    text,
    structured: emitFenced ? '```json\n' + JSON.stringify(structured) + '\n```' : structured,
    sources,
    steps,
    pages,
    confidence,
  }
}

function buildStructured(rng: () => number, schema: AiOutputField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema) {
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
      const y = 2019 + Math.floor(rng() * 7)
      const m = 1 + Math.floor(rng() * 12)
      const d = 1 + Math.floor(rng() * 28)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    case 'url':
      return `https://${pick(rng, DOMAINS)}`
    case 'email':
      return `${pick(rng, FIRST_NAMES)}.${pick(rng, LAST_NAMES)}@example.com`
    case 'phone':
      return `+1 ${200 + Math.floor(rng() * 799)} 555 ${String(Math.floor(rng() * 10000)).padStart(4, '0')}`
    default:
      return `${pick(rng, INDUSTRIES)} · ${pick(rng, FINDINGS)}`
  }
}
