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
export { MockApi } from './mockApi'
export type { MockApiOptions } from './mockApi'

import type { CascadeApi } from './api'
import { MockApi } from './mockApi'
import type { MockApiOptions } from './mockApi'

let singleton: CascadeApi | null = null

/** The process-wide API singleton (MockApi in Phase 1). */
export function getApi(): CascadeApi {
  if (!singleton) singleton = new MockApi()
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
