'use client'
// A windowed record cache for the grid. Rows are fetched in pages of 100 from
// @cascade/data (`records.list`) and served synchronously to Glide's
// `getCellContent`: a hit returns the row, a miss returns `undefined` and
// enqueues the page (the caller draws a StatusCell shimmer meanwhile). The row
// count comes from `records.count`. This keeps 100k-row tables scrolling
// smoothly — only the visible window is ever in memory.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { CascadeApi } from '@cascade/data'
import type { CellValue, RowWithCells } from '@cascade/core'

/** Page size for the windowed cache. */
export const PAGE_SIZE = 100

export interface TableData {
  /** Total rows after the active view's filters. */
  rowCount: number
  /** True once the initial count has resolved. */
  ready: boolean
  /** Synchronous row accessor; a miss enqueues the page and returns undefined. */
  getRow: (row: number) => RowWithCells | undefined
  /** Prefetch every page covering [startRow, endRow] (from onVisibleRegionChanged). */
  ensureRange: (startRow: number, endRow: number) => void
  /** Patch a cached cell in place (optimistic edits + server reconciliation). */
  applyEdit: (recordId: string, columnId: string, value: CellValue, updatedAt: string) => void
  /** Drop the cache and re-read the count (after add/delete row, view change). */
  reload: () => void
}

export function useTableData(api: CascadeApi, tableId: string, viewId?: string): TableData {
  const [rowCount, setRowCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [, bump] = useReducer((x: number) => x + 1, 0)

  const pagesRef = useRef<Map<number, RowWithCells[]>>(new Map())
  const pendingRef = useRef<Set<number>>(new Set())
  const rowCountRef = useRef(0)
  // Bumped on every reset so late async responses from a stale table/view drop.
  const genRef = useRef(0)

  useEffect(() => {
    const gen = (genRef.current += 1)
    pagesRef.current = new Map()
    pendingRef.current = new Set()
    setReady(false)
    let cancelled = false
    api.records.count(tableId, viewId).then(
      (c) => {
        if (cancelled || gen !== genRef.current) return
        rowCountRef.current = c
        setRowCount(c)
        setReady(true)
      },
      () => {
        if (!cancelled && gen === genRef.current) setReady(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, tableId, viewId])

  const ensurePage = useCallback(
    (page: number) => {
      if (page < 0) return
      const pages = pagesRef.current
      const pending = pendingRef.current
      if (pages.has(page) || pending.has(page)) return
      pending.add(page)
      const gen = genRef.current
      api.records.list(tableId, { viewId, offset: page * PAGE_SIZE, limit: PAGE_SIZE }).then(
        (res) => {
          if (gen !== genRef.current) return
          pages.set(page, res.rows)
          pending.delete(page)
          if (res.total !== rowCountRef.current) {
            rowCountRef.current = res.total
            setRowCount(res.total)
          }
          bump()
        },
        () => {
          if (gen === genRef.current) pending.delete(page)
        },
      )
    },
    [api, tableId, viewId],
  )

  const getRow = useCallback(
    (row: number): RowWithCells | undefined => {
      if (row < 0) return undefined
      const page = Math.floor(row / PAGE_SIZE)
      const rows = pagesRef.current.get(page)
      if (!rows) {
        ensurePage(page)
        return undefined
      }
      return rows[row % PAGE_SIZE]
    },
    [ensurePage],
  )

  const ensureRange = useCallback(
    (startRow: number, endRow: number) => {
      const first = Math.floor(Math.max(0, startRow) / PAGE_SIZE)
      const last = Math.floor(Math.max(0, endRow) / PAGE_SIZE)
      for (let p = first; p <= last; p += 1) ensurePage(p)
    },
    [ensurePage],
  )

  const applyEdit = useCallback(
    (recordId: string, columnId: string, value: CellValue, updatedAt: string) => {
      const pages = pagesRef.current
      for (const [page, rows] of pages) {
        const idx = rows.findIndex((r) => r.row.id === recordId)
        if (idx === -1) continue
        const r = rows[idx]
        if (!r) break
        const prevCell = r.cells[columnId]
        const nextRow: RowWithCells = {
          row: { ...r.row, updatedAt },
          cells: {
            ...r.cells,
            [columnId]: { recordId, columnId, value, meta: prevCell ? prevCell.meta : {} },
          },
        }
        const copy = rows.slice()
        copy[idx] = nextRow
        pages.set(page, copy)
        break
      }
      bump()
    },
    [],
  )

  const reload = useCallback(() => {
    const gen = (genRef.current += 1)
    pagesRef.current = new Map()
    pendingRef.current = new Set()
    api.records.count(tableId, viewId).then(
      (c) => {
        if (gen !== genRef.current) return
        rowCountRef.current = c
        setRowCount(c)
        bump()
      },
      () => {},
    )
  }, [api, tableId, viewId])

  return { rowCount, ready, getRow, ensureRange, applyEdit, reload }
}
