// Unit tests for the env-flag backend selection (resolveApi). getApi() reads
// NEXT_PUBLIC_API_BACKEND / NEXT_PUBLIC_API_BASE_URL and delegates here; we test
// the pure factory so there's no dependence on the module-level singleton or the
// build-time env inlining.

import { describe, expect, it } from 'vitest'
import { HttpApi, MockApi, resolveApi } from '../index'

describe('resolveApi — data backend selection', () => {
  it('defaults to MockApi when no config is given', () => {
    expect(resolveApi()).toBeInstanceOf(MockApi)
  })

  it('returns MockApi for backend "mock" (case-insensitive, trimmed)', () => {
    expect(resolveApi({ backend: 'mock' })).toBeInstanceOf(MockApi)
    expect(resolveApi({ backend: '  MOCK ' })).toBeInstanceOf(MockApi)
  })

  it('treats an unrecognized backend as mock (safe default)', () => {
    expect(resolveApi({ backend: 'postgres' })).toBeInstanceOf(MockApi)
  })

  it('returns HttpApi for backend "http" when a base url is set', () => {
    expect(resolveApi({ backend: 'http', baseUrl: 'https://api.example.com' })).toBeInstanceOf(HttpApi)
    expect(resolveApi({ backend: 'HTTP', baseUrl: 'http://localhost:8000' })).toBeInstanceOf(HttpApi)
  })

  it('throws a clear error when backend is "http" but the base url is missing/blank', () => {
    expect(() => resolveApi({ backend: 'http' })).toThrow(/NEXT_PUBLIC_API_BASE_URL/)
    expect(() => resolveApi({ backend: 'http', baseUrl: '   ' })).toThrow(/NEXT_PUBLIC_API_BASE_URL/)
  })
})
