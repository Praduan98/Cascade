// Interaction test for the grid's windowed data provider (useTableData) — the
// hook Glide's getCellContent reads from. It pages rows in from @cascade/data,
// serves cached rows synchronously (a miss returns undefined and enqueues the
// page so the caller can draw a shimmer), and exposes in-place patchers for the
// two things that must update a visible cell without a refetch: an optimistic
// manual edit, and a live per-cell enrichment status transition. We drive it
// against a real MockApi so the paging + reconciliation run end-to-end.

import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockApi, SEED_IDS } from '@cascade/data'
import { useTableData } from '@cascade/grid'
import type { Column, EnrichmentCellMeta } from '@cascade/core'

const { T } = SEED_IDS

let api: MockApi
let textCol: Column

beforeEach(async () => {
  api = new MockApi({ latency: false, storageKey: 'test:dp' })
  textCol = (await api.columns.list(T.companies)).find((c) => c.type === 'text')!
})

describe('useTableData', () => {
  it('resolves the view row count and flips ready', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rowCount).toBe(60) // seeded company records
  })

  it('returns undefined for an uncached row, enqueues the page, then serves it', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))
    await waitFor(() => expect(result.current.ready).toBe(true))

    // First touch is a cache miss (enqueues page 0 in the background).
    let first: ReturnType<typeof result.current.getRow>
    act(() => {
      first = result.current.getRow(0)
    })
    expect(first).toBeUndefined()

    // Once the page lands, the same accessor serves the row synchronously.
    await waitFor(() => expect(result.current.getRow(0)).toBeDefined())
    const row = result.current.getRow(0)!
    expect(row.row.id).toBeTruthy()
    expect(row.cells[textCol.id]?.value).toBeTypeOf('string')
  })

  it('ensureRange prefetches every row across the requested span', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.ensureRange(0, 40))

    await waitFor(() => {
      expect(result.current.getRow(0)).toBeDefined()
      expect(result.current.getRow(40)).toBeDefined()
    })
  })

  it('applyEdit patches a cached cell in place (optimistic manual edit)', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => {
      result.current.getRow(0)
    })
    await waitFor(() => expect(result.current.getRow(0)).toBeDefined())

    const before = result.current.getRow(0)!
    const stamp = '2030-01-01T00:00:00.000Z'
    act(() => result.current.applyEdit(before.row.id, textCol.id, 'Renamed Co', stamp))

    const after = result.current.getRow(0)!
    expect(after.cells[textCol.id]?.value).toBe('Renamed Co')
    expect(after.row.updatedAt).toBe(stamp) // reconciled server timestamp
  })

  it('applyEnrichment overlays live per-cell status onto the cached cell', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => {
      result.current.getRow(0)
    })
    await waitFor(() => expect(result.current.getRow(0)).toBeDefined())

    const before = result.current.getRow(0)!
    const meta: EnrichmentCellMeta = {
      status: 'running',
      providerId: null,
      stepIndex: null,
      runId: 'run_test',
      credits: 0,
      fromCache: false,
      fetchedAt: null,
      valueSource: 'provider',
    }
    act(() => result.current.applyEnrichment(before.row.id, textCol.id, meta))

    const after = result.current.getRow(0)!
    expect(after.cells[textCol.id]?.meta.enrichment?.status).toBe('running')
    expect(after.cells[textCol.id]?.meta.enrichment?.runId).toBe('run_test')
  })

  it('reload re-reads the row count after a mutation', async () => {
    const { result } = renderHook(() => useTableData(api, T.companies))
    await waitFor(() => expect(result.current.ready).toBe(true))

    await api.records.add(T.companies)
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.rowCount).toBe(61))
  })

  // Regression: a reload firing *before* the initial mount count resolves — the
  // window React StrictMode's double-invoked effects opened in dev — bumps the
  // generation counter and orphans that in-flight count. `ready` must still flip
  // (reload asserts readiness on success); otherwise the grid canvas never
  // mounts and the whole table renders blank.
  it('flips ready even when reload races ahead of the initial count', async () => {
    const slow = new MockApi({ latency: true, storageKey: 'test:dp-race' })
    const { result } = renderHook(() => useTableData(slow, T.companies))

    // The mount count is still in flight here; simulate the racing reload.
    expect(result.current.ready).toBe(false)
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rowCount).toBe(60)
  })
})
