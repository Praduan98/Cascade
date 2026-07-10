// MockEnrichmentEngine — a framework-agnostic simulation of the Phase-2
// enrichment orchestration layer. Owned by MockApi; no React, no DOM.
//
// It drives targeted cells through Queued → Running → (Success | Empty | Failed
// | Cached) asynchronously via an injectable `schedule` (setTimeout in the app,
// synchronous in tests), implementing the FSD waterfall semantics: providers run
// in order, fall through on empty, stop on the first accepted result, an inline
// email verification gate (US-2.14), atomic credit metering (FR-2.4), TTL
// caching with real hits (US-2.9), retry/backoff with no double-charge (US-2.8),
// and budget caps that block before or pause during a run (US-2.11). Provenance
// is mirrored onto `cell.meta.enrichment` so per-cell status survives reload
// (US-2.6 / FR-2.5).
//
// Determinism: results are seeded from the hashed, normalized input, so re-runs
// are stable and cache hits return the identical payload.

import type {
  AcceptanceCondition,
  CellValue,
  Column,
  EnrichmentCellMeta,
  EnrichmentCellResult,
  EnrichmentColumnConfig,
  EnrichmentOperation,
  EnrichmentRun,
  EnrichmentStep,
  Provider,
  ProviderCredential,
} from '@cascade/core'
import { columnTypeRegistry, newId } from '@cascade/core'
import type { EnrichmentEvent } from './api'
import type { Store } from './store'
import { frac, hashString, mulberry32, OperationRunner, PAUSE, snapshotRun } from './operationRunner'
import type { OpEngineDeps, TerminalStatus } from './operationRunner'

// ---------------------------------------------------------------------------
// Engine wiring
// ---------------------------------------------------------------------------

/** The enrichment engine's deps — the shared runner deps typed to its event. */
export type EngineDeps = OpEngineDeps<EnrichmentEvent>

/** One (record × anchor column) unit of work in a run. */
export interface RunTarget {
  recordId: string
  anchorColumnId: string
  config: EnrichmentColumnConfig
  orderIndex: number
}

const MAX_RETRIES = 2
const TRANSIENT_RATE = 0.05
// A slice of transient failures are provider rate-limit (HTTP 429) responses,
// which back off and retry rather than failing immediately (US-2.8). A true
// global per-provider token bucket (FR-2.6) spans workers and belongs in the
// real adapter layer, not this synchronous mock; here we model the 429 path.
const RATE_LIMIT_RATE = 0.02

// Per-operation probability that the provider genuinely finds nothing, so the
// waterfall visibly falls through step to step.
const EMPTY_RATE: Record<EnrichmentOperation, number> = {
  person_enrich: 0.35,
  company_enrich: 0.1,
  find_email: 0.22,
  find_phone: 0.3,
  verify_email: 0,
}

const FIRST_NAMES = ['jordan', 'rosa', 'marco', 'priya', 'sam', 'lena', 'omar', 'nina', 'diego', 'ava', 'theo', 'mira']
const LAST_NAMES = ['okoye', 'nair', 'klein', 'advani', 'reyes', 'baxter', 'nomura', 'silva', 'khan', 'foster', 'ionescu', 'park']

// ---------------------------------------------------------------------------
// Input normalization (FR-2.3 — applied before cache key + provider call)
// ---------------------------------------------------------------------------

function normalizeField(field: string, raw: CellValue): string {
  const s = Array.isArray(raw) ? raw.join(',') : raw == null ? '' : String(raw)
  const f = field.toLowerCase()
  if (f.includes('email')) return s.trim().toLowerCase()
  if (f.includes('domain') || f.includes('website') || f.includes('url')) {
    return s
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
  }
  if (f.includes('phone')) return s.replace(/\D/g, '')
  if (f.includes('name')) return s.trim().toLowerCase()
  return s.trim().toLowerCase()
}

function normalizeInputs(inputs: Record<string, CellValue>): string {
  return Object.keys(inputs)
    .sort()
    .map((k) => `${k}=${normalizeField(k, inputs[k] ?? null)}`)
    .join('&')
}

export function isEmptyInput(v: CellValue): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

/** The cache key for a step's inputs — shared by the engine and `estimate`. */
export function buildCacheKey(providerId: string, operation: EnrichmentOperation, inputs: Record<string, CellValue>): string {
  return `${providerId}|${operation}|${normalizeInputs(inputs)}`
}

/**
 * True when the workspace has supplied its own (active) key for a provider.
 * BYO usage is billed to the workspace by the provider, so the platform incurs
 * no internal provider cost for it (US-2.13). Shared by the engine (actual
 * charge) and `computeEstimate` (max-cost preview) so the two never diverge.
 */
export function byoActive(creds: ProviderCredential[], workspaceId: string, providerId: string): boolean {
  const c = creds.find((x) => x.workspaceId === workspaceId && x.providerId === providerId)
  return !!c && c.isPlatformManaged === false && c.status === 'active'
}

// ---------------------------------------------------------------------------
// Provider call simulation
// ---------------------------------------------------------------------------

type GenResult = { empty: true } | { empty: false; fields: Record<string, CellValue>; confidence: number | null }

interface ProviderCall {
  hardFail?: boolean
  reason?: string
  empty?: boolean
  fields?: Record<string, CellValue>
  confidence?: number | null
  retried: number
}

// ---------------------------------------------------------------------------
// Terminal outcome of walking a waterfall for one cell
// ---------------------------------------------------------------------------

interface WalkOutcome {
  status: TerminalStatus
  providerId: string | null
  stepIndex: number | null
  credits: number
  providerCostUsd: number
  fromCache: boolean
  confidence: number | null
  reason?: string
  /** Output cell values written by the accepted step (incl. the anchor). */
  writes: Array<{ columnId: string; value: CellValue }>
}

export class MockEnrichmentEngine extends OperationRunner<RunTarget, WalkOutcome, EnrichmentEvent> {
  constructor(d: EngineDeps) {
    super(d)
  }

  // ---- per-operation hooks (see OperationRunner) -------------------------

  protected resolve(run: EnrichmentRun, t: RunTarget): WalkOutcome | typeof PAUSE {
    return this.walkWaterfall(run, t)
  }

  protected failureOutcome(reason: string): WalkOutcome {
    return {
      status: 'failed',
      providerId: null,
      stepIndex: null,
      credits: 0,
      providerCostUsd: 0,
      fromCache: false,
      confidence: null,
      reason,
      writes: [],
    }
  }

  protected emitRun(run: EnrichmentRun): void {
    this.d.emit({ type: 'run', run: snapshotRun(run) })
  }

  protected emitBudget(workspaceId: string, balance: number, paused: boolean): void {
    this.d.emit({ type: 'budget', workspaceId, balance, paused })
  }

  protected runsList(): EnrichmentRun[] {
    return this.d.store.data.enrichmentRuns
  }

  protected cellMetaKey(): 'enrichment' {
    return 'enrichment'
  }

  // ---- public API --------------------------------------------------------

  /** Flip orphaned in-flight cells + runs to Failed on load. */
  reconcileOnLoad(): void {
    this.reconcile()
  }

  /**
   * Auto-run enrichment for freshly-added rows on columns with autoRun enabled
   * and required inputs present (US-2.7). Returns the created run, or null.
   */
  autoRun(
    tableId: string,
    recordIds: string[],
    actor: { id: string; name: string },
    makeRun: (targets: RunTarget[]) => EnrichmentRun | null,
  ): EnrichmentRun | null {
    const configs = this.d.store.getConfigsForTable(tableId).filter((c) => c.autoRun && c.steps.length > 0)
    if (configs.length === 0) return null
    const targets: RunTarget[] = []
    let order = 0
    for (const rid of recordIds) {
      for (const cfg of configs) {
        if (this.firstStepInputsPresent(rid, cfg)) {
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

  // ---- the waterfall -----------------------------------------------------

  private walkWaterfall(run: EnrichmentRun, t: RunTarget): WalkOutcome | typeof PAUSE {
    const { config, recordId } = t
    const buffer: Record<string, CellValue> = {}
    let accepted: WalkOutcome | null = null
    let lastReason = 'no usable result'
    // Credits already deducted for calls that were then rejected (below the
    // acceptance condition, or revoked by a failed verify). The ledger charge
    // legitimately stands (a provider call was made — FR-2.4), so these must be
    // carried into the terminal outcome; otherwise per-cell provenance and the
    // by-column/by-table usage views under-report and stop reconciling with the
    // ledger, and a credit-consuming cell would mislabel as Empty/0 (US-2.10).
    let sunkCredits = 0
    let sunkUsd = 0

    for (let stepIndex = 0; stepIndex < config.steps.length; stepIndex++) {
      const step = config.steps[stepIndex]
      if (!step) continue
      const provider = this.d.store.data.providers.find((p) => p.id === step.providerId)
      if (!provider) {
        lastReason = 'provider unavailable'
        continue
      }
      const isVerify = step.operation === 'verify_email'

      // Finder steps stop once we have an accepted value; verify steps still run.
      if (accepted && !isVerify) continue

      // Build inputs from the mapping (reading prior writes first, then the store).
      const inputs: Record<string, CellValue> = {}
      let missing: string | null = null
      for (const [field, colId] of Object.entries(step.inputMapping)) {
        const v: CellValue = (colId in buffer ? buffer[colId] : this.d.store.getCell(recordId, colId)?.value) ?? null
        if (isEmptyInput(v)) {
          missing = field
          break
        }
        inputs[field] = v
      }
      if (missing) {
        lastReason = `missing input: ${missing}`
        continue
      }

      const normalized = normalizeInputs(inputs)
      const cacheKey = `${provider.id}|${step.operation}|${normalized}`

      // Cache lookup (free) unless the run forces a fresh fetch.
      let fields: Record<string, CellValue> | null = null
      let confidence: number | null = null
      let fromCache = false
      let charged = 0
      let chargedUsd = 0

      const cached = run.forceFresh ? undefined : this.d.store.getCacheEntry(cacheKey)
      if (cached && Date.parse(cached.expiresAt) > Date.parse(this.d.now())) {
        const payload = cached.resultJson as { fields?: Record<string, CellValue>; confidence?: number | null }
        fields = payload?.fields ?? null
        confidence = payload?.confidence ?? null
        fromCache = true
      } else {
        // A real call is imminent — resolve the workspace credential (US-2.13).
        const cred = this.d.store.data.providerCredentials.find(
          (c) => c.workspaceId === run.workspaceId && c.providerId === provider.id,
        )
        // An entered-but-invalid/revoked key surfaces a clear config error rather
        // than silently fabricating data on every row. A missing credential is
        // fine: platform-managed providers work out of the box.
        if (cred && cred.status !== 'active') {
          return {
            status: 'failed',
            providerId: provider.id,
            stepIndex,
            credits: 0,
            providerCostUsd: 0,
            fromCache: false,
            confidence: null,
            reason: `invalid or revoked API key for ${provider.name} — update it in Providers`,
            writes: [],
          }
        }
        // BYO keys are billed to the workspace by the provider, so the platform
        // records $0 internal provider cost (credits are still metered).
        const effectiveCostUsd = cred && cred.isPlatformManaged === false ? 0 : step.providerCostUsd

        const call = this.callProvider(provider, step, inputs, normalized)
        if (call.hardFail) {
          // Persistent failure marks the cell Failed (does not fall through, US-2.8).
          return {
            status: 'failed',
            providerId: provider.id,
            stepIndex,
            credits: 0,
            providerCostUsd: 0,
            fromCache: false,
            confidence: null,
            reason: call.reason,
            writes: [],
          }
        }
        if (call.empty) {
          lastReason = 'no data'
          continue // free fall-through
        }
        // A real provider returned data — charge atomically before accepting.
        if (!this.tryCharge(run, step.credits, effectiveCostUsd, `enrich:${provider.key}:${step.operation}`)) {
          return PAUSE
        }
        charged = step.credits
        chargedUsd = effectiveCostUsd
        fields = call.fields ?? {}
        confidence = call.confidence ?? null
        this.d.store.putCacheEntry({
          id: newId(),
          cacheKey,
          providerId: provider.id,
          operation: step.operation,
          resultJson: { fields, confidence },
          cost: effectiveCostUsd,
          fetchedAt: this.d.now(),
          expiresAt: new Date(Date.parse(this.d.now()) + provider.defaultTtlDays * 86400_000).toISOString(),
        })
      }

      if (!fields) {
        lastReason = 'no data'
        continue
      }

      // Map provider output fields → destination columns, coercing to each type.
      const writes = this.mapOutputs(step, fields)

      // A verify step gates the previously-accepted value.
      if (isVerify) {
        for (const w of writes) buffer[w.columnId] = w.value
        const verdict = String(fields.deliverable ?? fields.verify_status ?? '').toLowerCase()
        if (step.acceptanceCondition === 'verifyDeliverable' && verdict !== 'deliverable') {
          // Reject: revoke the found email and fall through to later finders. Both
          // the verify call's charge and the now-revoked finder's charge stand in
          // the ledger, so sink them so the terminal outcome still reconciles.
          sunkCredits += charged
          sunkUsd += chargedUsd
          if (accepted) {
            sunkCredits += accepted.credits
            sunkUsd += accepted.providerCostUsd
            for (const w of accepted.writes) delete buffer[w.columnId]
            accepted = null
          }
          lastReason = `verify: ${verdict || 'undeliverable'}`
          continue
        }
        // Verified acceptable — merge the verdict into the accepted result.
        if (accepted) {
          const prev: WalkOutcome = accepted
          accepted = { ...prev, writes: mergeWrites(prev.writes, writes), credits: prev.credits + charged, providerCostUsd: prev.providerCostUsd + chargedUsd }
        } else {
          accepted = { status: fromCache ? 'cached' : 'success', providerId: provider.id, stepIndex, credits: charged, providerCostUsd: chargedUsd, fromCache, confidence, writes }
        }
        continue
      }

      // Finder step — evaluate its acceptance condition.
      if (!this.passesAcceptance(step, fields, confidence)) {
        // Rejected; the credit already charged stands in the ledger, so sink it
        // into the terminal outcome (do not silently drop it — US-2.10).
        sunkCredits += charged
        sunkUsd += chargedUsd
        lastReason = 'below acceptance condition'
        continue
      }
      for (const w of writes) buffer[w.columnId] = w.value
      accepted = {
        status: fromCache ? 'cached' : 'success',
        providerId: provider.id,
        stepIndex,
        credits: charged,
        providerCostUsd: chargedUsd,
        fromCache,
        confidence,
        writes,
      }
    }

    if (accepted) {
      // Fold any charged-but-rejected credits into the accepted result so the
      // per-cell total matches the ledger.
      return { ...accepted, credits: accepted.credits + sunkCredits, providerCostUsd: accepted.providerCostUsd + sunkUsd }
    }
    return {
      status: 'empty',
      providerId: null,
      stepIndex: null,
      // Nothing was accepted, but earlier steps may have charged (and been
      // rejected). Attribute that spend here so the cell isn't shown as free.
      credits: sunkCredits,
      providerCostUsd: sunkUsd,
      fromCache: false,
      confidence: null,
      reason: lastReason,
      writes: [],
    }
  }

  private firstStepInputsPresent(recordId: string, cfg: EnrichmentColumnConfig): boolean {
    const step = cfg.steps[0]
    if (!step) return false
    return Object.values(step.inputMapping).every((colId) => !isEmptyInput(this.d.store.getCell(recordId, colId)?.value ?? null))
  }

  // ---- provider + acceptance + output mapping ----------------------------

  private callProvider(
    provider: Provider,
    step: EnrichmentStep,
    inputs: Record<string, CellValue>,
    normalized: string,
  ): ProviderCall {
    let retried = 0
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const transientRoll = frac(hashString(`${normalized}|t|${attempt}|${step.operation}`))
      if (transientRoll < TRANSIENT_RATE) {
        const kind = transientRoll < RATE_LIMIT_RATE ? 'rate limited (429)' : 'provider timeout'
        if (attempt < MAX_RETRIES) {
          retried += 1
          continue // backoff & retry (a real engine would wait here)
        }
        return { hardFail: true, reason: `${kind} · retried ×${retried}`, retried }
      }
      const gen = this.generate(provider, step.operation, inputs, normalized)
      if (gen.empty) return { empty: true, retried }
      return { fields: gen.fields, confidence: gen.confidence, retried }
    }
    /* c8 ignore next */
    return { empty: true, retried }
  }

  private generate(
    provider: Provider,
    operation: EnrichmentOperation,
    inputs: Record<string, CellValue>,
    normalized: string,
  ): GenResult {
    const rng = mulberry32(hashString(`${normalized}|g|${operation}|${provider.key}`))
    if (rng() < (EMPTY_RATE[operation] ?? 0)) return { empty: true }

    const domain = firstDefined(inputs, ['domain', 'website', 'url', 'company_domain']) ?? `${pick(rng, LAST_NAMES)}.io`
    const first = normStr(firstDefined(inputs, ['first_name', 'firstName'])) || pick(rng, FIRST_NAMES)
    const last = normStr(firstDefined(inputs, ['last_name', 'lastName'])) || pick(rng, LAST_NAMES)

    switch (operation) {
      case 'find_email':
      case 'person_enrich': {
        const email = `${first}.${last}@${cleanDomain(domain)}`.toLowerCase()
        return { empty: false, fields: { email }, confidence: 0.6 + rng() * 0.38 }
      }
      case 'company_enrich': {
        const employees = 8 + Math.floor(rng() * 7992)
        return { empty: false, fields: { employees }, confidence: 0.7 + rng() * 0.28 }
      }
      case 'find_phone': {
        const area = 200 + Math.floor(rng() * 799)
        const line = String(Math.floor(rng() * 10000)).padStart(4, '0')
        return { empty: false, fields: { phone: `+1 ${area} 555 ${line}` }, confidence: 0.5 + rng() * 0.4 }
      }
      case 'verify_email': {
        const r = rng()
        const verdict = r < 0.72 ? 'Deliverable' : r < 0.86 ? 'Risky' : r < 0.95 ? 'Undeliverable' : 'Unknown'
        return { empty: false, fields: { deliverable: verdict }, confidence: r }
      }
    }
  }

  private passesAcceptance(step: EnrichmentStep, fields: Record<string, CellValue>, confidence: number | null): boolean {
    const cond: AcceptanceCondition = step.acceptanceCondition
    switch (cond) {
      case 'empty':
        return Object.values(fields).some((v) => !isEmptyInput(v))
      case 'nonEmptyField':
        return step.acceptField ? !isEmptyInput(fields[step.acceptField] ?? null) : true
      case 'minConfidence':
        return confidence != null && confidence >= (step.minConfidence ?? 0)
      case 'verifyDeliverable':
        // A finder step with a verify gate: verify the email inline here.
        return String(fields.deliverable ?? '').toLowerCase() === 'deliverable'
    }
  }

  private mapOutputs(step: EnrichmentStep, fields: Record<string, CellValue>): Array<{ columnId: string; value: CellValue }> {
    const writes: Array<{ columnId: string; value: CellValue }> = []
    for (const [field, columnId] of Object.entries(step.outputMapping)) {
      const raw = fields[field]
      if (raw === undefined) continue
      const col = this.d.store.data.columns.find((c) => c.id === columnId)
      if (!col) continue
      const res = columnTypeRegistry[col.type].validate(raw, col.config)
      const value = res.ok ? res.value : null
      if (!columnTypeRegistry[col.type].isEmpty(value)) writes.push({ columnId, value })
    }
    return writes
  }

  // ---- persistence of a terminal cell ------------------------------------

  protected applyTerminal(run: EnrichmentRun, t: RunTarget, outcome: WalkOutcome): void {
    const ts = this.d.now()
    const meta: EnrichmentCellMeta = {
      status: outcome.status,
      providerId: outcome.providerId,
      stepIndex: outcome.stepIndex,
      runId: run.id,
      confidence: outcome.confidence,
      credits: outcome.credits,
      fromCache: outcome.fromCache,
      reason: outcome.reason,
      fetchedAt: ts,
      valueSource: outcome.fromCache ? 'cache' : 'provider',
    }

    const written = new Set<string>()
    for (const w of outcome.writes) {
      const existing = this.d.store.getCell(t.recordId, w.columnId)
      this.d.store.setCell({ recordId: t.recordId, columnId: w.columnId, value: w.value, meta: { ...(existing?.meta ?? {}), enrichment: meta } })
      written.add(w.columnId)
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: w.columnId, meta, value: w.value })
    }

    // Always stamp the anchor's status, keeping any prior value on empty/failed.
    if (!written.has(t.anchorColumnId)) {
      const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
      const value = existing?.value ?? null
      this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), enrichment: meta } })
      this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
    }

    this.d.store.data.enrichmentResults.push({
      id: newId(),
      recordId: t.recordId,
      columnId: t.anchorColumnId,
      runId: run.id,
      providerId: outcome.providerId,
      stepIndex: outcome.stepIndex,
      status: outcome.status,
      valueJson: this.d.store.getCell(t.recordId, t.anchorColumnId)?.value ?? null,
      confidence: outcome.confidence,
      credits: outcome.credits,
      providerCostUsd: outcome.providerCostUsd,
      fromCache: outcome.fromCache,
      reason: outcome.reason,
      fetchedAt: ts,
    } satisfies EnrichmentCellResult)
  }

  protected stampInterim(run: EnrichmentRun, t: RunTarget, status: 'queued' | 'running'): void {
    const existing = this.d.store.getCell(t.recordId, t.anchorColumnId)
    const meta: EnrichmentCellMeta = {
      status,
      providerId: existing?.meta?.enrichment?.providerId ?? null,
      stepIndex: null,
      runId: run.id,
      confidence: null,
      credits: 0,
      fromCache: false,
      fetchedAt: null,
      valueSource: 'provider',
    }
    const value = existing?.value ?? null
    this.d.store.setCell({ recordId: t.recordId, columnId: t.anchorColumnId, value, meta: { ...(existing?.meta ?? {}), enrichment: meta } })
    this.d.emit({ type: 'cell', runId: run.id, tableId: run.tableId, recordId: t.recordId, columnId: t.anchorColumnId, meta, value })
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function mergeWrites(
  a: Array<{ columnId: string; value: CellValue }>,
  b: Array<{ columnId: string; value: CellValue }>,
): Array<{ columnId: string; value: CellValue }> {
  const map = new Map(a.map((w) => [w.columnId, w] as const))
  for (const w of b) map.set(w.columnId, w)
  return [...map.values()]
}

function firstDefined(inputs: Record<string, CellValue>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = inputs[k]
    if (v != null && v !== '') return Array.isArray(v) ? v.join(' ') : String(v)
  }
  return undefined
}

function normStr(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T
}
