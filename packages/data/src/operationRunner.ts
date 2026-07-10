// OperationRunner — the shared execution pipeline for every metered, async,
// per-cell operation in Cascade (FR-3.1 "no parallel execution path"; the
// architecture principle "every operation runs one pipeline").
//
// It owns the six-state status machine — Queued → Running → (Success | Empty |
// Failed | Cached) — driven by an injectable `schedule` (setTimeout in the app,
// synchronous in tests): staggered queueing, deterministic latency, atomic
// credit metering, budget pause-on-overdraw, terminal persistence, live event
// emission, and reconcile-on-load. The *per-operation* logic (how a cell is
// resolved, how its provenance is stamped, which events/arrays it uses) is
// supplied by a subclass via abstract hooks. Phase 2's waterfall enrichment and
// Phase 3's AI columns are both subclasses; new operation kinds (agent, HTTP,
// webhooks) plug in the same way.

import type { EnrichmentRun } from '@cascade/core'
import { newId } from '@cascade/core'
import type { Store } from './store'

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export interface OpEngineDeps<TEvent> {
  store: Store
  /** Throttled persist to localStorage. */
  persist: () => void
  emit: (e: TEvent) => void
  now: () => string
  /** setTimeout in the app; synchronous `fn()` in tests. */
  schedule: (fn: () => void, ms: number) => void
}

/** The minimum a runner needs from a unit of work. */
export interface OpTarget {
  recordId: string
  anchorColumnId: string
  orderIndex: number
}

export type TerminalStatus = 'success' | 'empty' | 'failed' | 'cached'

/** The minimum a runner needs from a per-operation terminal outcome. */
export interface OpOutcomeBase {
  status: TerminalStatus
}

/** Signals a run must pause because a required charge exceeds the balance. */
export const PAUSE = Symbol('pause')

const QUEUE_STAGGER_MS = 24
const QUEUE_STAGGER_CAP = 800

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness (shared by every operation engine)
// ---------------------------------------------------------------------------

export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function frac(seed: number): number {
  return (seed >>> 0) / 4294967296
}

export function snapshotRun(run: EnrichmentRun): EnrichmentRun {
  return { ...run, counts: { ...run.counts }, scope: { ...run.scope } }
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export abstract class OperationRunner<TTarget extends OpTarget, TOutcome extends OpOutcomeBase, TEvent> {
  private activeRuns = new Set<string>()
  private idleWaiters: Array<() => void> = []

  constructor(protected d: OpEngineDeps<TEvent>) {}

  // ---- per-operation hooks (implemented by each subclass) ----------------

  /** Resolve one cell, or return PAUSE if a required charge would overdraw. */
  protected abstract resolve(run: EnrichmentRun, t: TTarget): TOutcome | typeof PAUSE
  /** Stamp an interim (queued/running) status onto the anchor cell + emit. */
  protected abstract stampInterim(run: EnrichmentRun, t: TTarget, status: 'queued' | 'running'): void
  /** Persist the terminal cell(s) + provenance, emitting a cell event per write. */
  protected abstract applyTerminal(run: EnrichmentRun, t: TTarget, outcome: TOutcome): void
  /** A synthetic Failed outcome (used when resolve throws). */
  protected abstract failureOutcome(reason: string): TOutcome
  /** Emit a `{ type: 'run', run }` event (snapshotted). */
  protected abstract emitRun(run: EnrichmentRun): void
  /** Emit a `{ type: 'budget', ... }` event. */
  protected abstract emitBudget(workspaceId: string, balance: number, paused: boolean): void
  /** The runs array to strand on reconcile. */
  protected abstract runsList(): EnrichmentRun[]
  /** The `cell.meta.<key>` slot this operation writes ('enrichment' | 'ai'). */
  protected abstract cellMetaKey(): 'enrichment' | 'ai'

  // ---- public API --------------------------------------------------------

  /** Begin driving `targets` through their status transitions for `run`. */
  startRun(run: EnrichmentRun, targets: TTarget[]): void {
    this.activeRuns.add(run.id)
    // Seed every target as Queued immediately so the grid shows the run land.
    for (const t of targets) this.stampInterim(run, t, 'queued')
    run.counts.total = targets.length
    this.emitRun(run)
    if (targets.length === 0) {
      this.finishRun(run)
      return
    }
    targets.forEach((t, i) => {
      this.d.schedule(() => this.enterRunning(run, t), Math.min(i * QUEUE_STAGGER_MS, QUEUE_STAGGER_CAP))
    })
  }

  /** Resolves when no run is active (tests: `await api.__drain*()`). */
  whenIdle(): Promise<void> {
    if (this.activeRuns.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /** Flip orphaned in-flight cells (queued/running with no live timer) to Failed. */
  protected reconcile(): void {
    const key = this.cellMetaKey()
    let touched = false
    for (const cell of this.d.store.data.cells) {
      const e = cell.meta?.[key] as { status?: string } | undefined
      if (e && (e.status === 'queued' || e.status === 'running')) {
        cell.meta = {
          ...cell.meta,
          [key]: { ...e, status: 'failed', reason: 'interrupted — re-run', fetchedAt: this.d.now() },
        }
        touched = true
      }
    }
    for (const run of this.runsList()) {
      if (run.status === 'queued' || run.status === 'running') {
        run.status = 'failed'
        run.finishedAt = run.finishedAt ?? this.d.now()
        touched = true
      }
    }
    if (touched) this.d.persist()
  }

  // ---- run lifecycle -----------------------------------------------------

  private enterRunning(run: EnrichmentRun, t: TTarget): void {
    if (run.status === 'paused' || run.status === 'failed' || run.status === 'complete') return
    if (run.status === 'queued') {
      run.status = 'running'
      run.startedAt = this.d.now()
      this.emitRun(run)
    }
    this.stampInterim(run, t, 'running')
    const seed = hashString(`${t.recordId}|${t.anchorColumnId}|lat`)
    const latency = 200 + Math.floor(frac(seed) * 520)
    this.d.schedule(() => this.resolveTarget(run, t), latency)
  }

  private resolveTarget(run: EnrichmentRun, t: TTarget): void {
    if (run.status === 'paused' || run.status === 'failed' || run.status === 'complete') {
      this.stampInterim(run, t, 'queued') // leave it re-runnable
      return
    }
    let outcome: TOutcome | typeof PAUSE
    try {
      outcome = this.resolve(run, t)
    } catch {
      outcome = this.failureOutcome('unexpected error')
    }
    if (outcome === PAUSE) {
      run.status = 'paused'
      this.stampInterim(run, t, 'queued')
      const wc = this.d.store.getWorkspaceCredit(run.workspaceId)
      this.emitBudget(run.workspaceId, wc?.balance ?? 0, true)
      this.emitRun(run)
      this.d.persist()
      this.maybeIdle(run)
      return
    }
    this.applyTerminal(run, t, outcome)
    run.counts.processed += 1
    run.counts[outcome.status] += 1
    this.emitRun(run)
    this.d.persist()
    if (run.counts.processed >= run.counts.total) this.finishRun(run)
  }

  private finishRun(run: EnrichmentRun): void {
    if (run.status !== 'paused' && run.status !== 'failed') {
      run.status = 'complete'
      run.finishedAt = this.d.now()
    }
    this.emitRun(run)
    this.d.persist()
    this.maybeIdle(run)
  }

  private maybeIdle(run: EnrichmentRun): void {
    this.activeRuns.delete(run.id)
    if (this.activeRuns.size === 0) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const w of waiters) w()
    }
  }

  // ---- metering ----------------------------------------------------------

  /** Atomic charge; returns false if it would overdraw the balance (US-2.11). */
  protected tryCharge(run: EnrichmentRun, credits: number, providerCostUsd: number, reason: string): boolean {
    if (credits <= 0) return true
    const wc = this.d.store.getWorkspaceCredit(run.workspaceId)
    if (!wc) return true
    if (wc.balance - credits < 0) return false
    wc.balance -= credits
    this.d.store.data.creditLedger.push({
      id: newId(),
      workspaceId: run.workspaceId,
      delta: -credits,
      reason,
      runId: run.id,
      balanceAfter: wc.balance,
      createdAt: this.d.now(),
    })
    run.creditsConsumed += credits
    run.providerCostUsd += providerCostUsd
    return true
  }

  /**
   * Reverse credits already charged for a cell that is being abandoned (paused
   * mid-resolve because a later charge would overdraw). Writes a compensating
   * positive ledger entry (append-only preserved) and restores the balance and
   * run totals, so run.creditsConsumed === -Σ(ledger deltas) stays intact and the
   * re-queued cell — whose earlier steps are now cached — re-runs for free.
   */
  protected refundCharges(run: EnrichmentRun, credits: number, providerCostUsd: number): void {
    if (credits <= 0) return
    const wc = this.d.store.getWorkspaceCredit(run.workspaceId)
    if (!wc) return
    wc.balance += credits
    run.creditsConsumed -= credits
    run.providerCostUsd -= providerCostUsd
    this.d.store.data.creditLedger.push({
      id: newId(),
      workspaceId: run.workspaceId,
      delta: credits,
      reason: 'refund:paused-cell',
      runId: run.id,
      balanceAfter: wc.balance,
      createdAt: this.d.now(),
    })
  }
}
