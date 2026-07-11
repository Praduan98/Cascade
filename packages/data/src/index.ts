// @cascade/data — the API contract (interface) plus a MockApi implementation
// backed by an in-memory store persisted to localStorage, with realistic seed
// data. Consume `getApi()` everywhere; swapping in a real HttpApi later is a
// one-line change here.

export const DATA_VERSION = '1.0.0'

export * from './errors'
export * from './api'
export * from './store'
export * from './seed'
export { AI_MODELS, aiModelByKey, resolveAiModel, defaultAiModel } from './aiModels'
export { PLANS, CREDIT_PACKS, planById, planByTier } from './plans'
export { TEMPLATES, templateById } from './templates'
export { MockApi } from './mockApi'
export type { MockApiOptions } from './mockApi'
export { HttpApi } from './httpApi'
export type { HttpApiConfig } from './httpApi'

import type { CascadeApi } from './api'
import { MockApi } from './mockApi'
import { HttpApi } from './httpApi'
import type { MockApiOptions } from './mockApi'

let singleton: CascadeApi | null = null

/**
 * Pick a CascadeApi implementation from explicit config. Split out from getApi()
 * so the selection is unit-testable without the module-level singleton or env.
 *   • backend 'mock' (default, or anything unrecognized) → in-memory MockApi.
 *   • backend 'http' → the real HttpApi; requires `baseUrl` (the client then
 *     calls `${baseUrl}/v1`, per CONTRACT.md). Throws if it is missing.
 */
export function resolveApi(config?: { backend?: string; baseUrl?: string }): CascadeApi {
  const backend = (config?.backend ?? 'mock').trim().toLowerCase()
  if (backend === 'http' || backend === 'https' || backend === 'real') {
    const base = config?.baseUrl?.trim()
    if (!base) {
      throw new Error('Data backend is "http" (NEXT_PUBLIC_API_BACKEND) but NEXT_PUBLIC_API_BASE_URL is not set.')
    }
    return new HttpApi({ baseUrl: `${base.replace(/\/+$/, '')}/v1` })
  }
  return new MockApi()
}

// Literal NEXT_PUBLIC_* reads, kept as bare `process.env.<NAME>` member accesses
// so Next.js inlines them into the client bundle at build time. Guarded for
// runtimes where `process` is absent.
function envConfig(): { backend?: string; baseUrl?: string } {
  if (typeof process === 'undefined' || !process.env) return {}
  return {
    backend: process.env.NEXT_PUBLIC_API_BACKEND,
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  }
}

/**
 * The process-wide API singleton. Defaults to MockApi (Phase 1 behavior); set
 * NEXT_PUBLIC_API_BACKEND=http (plus NEXT_PUBLIC_API_BASE_URL) to drive the app
 * against the real HttpApi with no other change. Constructed once, then cached.
 */
export function getApi(): CascadeApi {
  if (!singleton) singleton = resolveApi(envConfig())
  return singleton
}

/** Replace the singleton (tests / injecting a configured MockApi or HttpApi). */
export function setApi(api: CascadeApi): void {
  singleton = api
}

/** Construct a fresh, isolated MockApi (does not touch the singleton). */
export function createMockApi(opts?: MockApiOptions): MockApi {
  return new MockApi(opts)
}
