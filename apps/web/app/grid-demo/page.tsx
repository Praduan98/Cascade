'use client'
// Grid demo — proves the Glide integration end to end: a 100k-row table that
// scrolls smoothly, typed cells for every column type, inline editing that
// round-trips through @cascade/data, and a live theme recolour (flip the toggle
// and watch the canvas repaint). Seeds an isolated, in-memory MockApi on the
// client only, so nothing heavy runs during SSR/build and the app's persisted
// store is left untouched.

import { useEffect, useState } from 'react'
import { createMockApi, SEED_IDS } from '@cascade/data'
import type { CascadeApi } from '@cascade/data'
import { ThemeButton } from '@cascade/ui'
import { TableGridDynamic } from '@cascade/grid'
import styles from './page.module.css'

const TARGET_ROWS = 100_000
const STORAGE_KEY = 'cascade:griddemo:v1'

interface Seeded {
  api: CascadeApi
  tableId: string
  viewId?: string
  rows: number
}

export default function GridDemoPage() {
  const [seeded, setSeeded] = useState<Seeded | null>(null)

  useEffect(() => {
    // Latency-free + isolated storage key so we never disturb the app's seed.
    const api = createMockApi({ latency: false, storageKey: STORAGE_KEY })
    const tableId = SEED_IDS.T.companies
    const store = api.rawStore
    const existing = store.data.records.filter((r) => r.tableId === tableId).length
    if (existing < TARGET_ROWS) api.loadPerfRows(tableId, TARGET_ROWS - existing)
    const rows = store.data.records.filter((r) => r.tableId === tableId).length
    const view = store.data.views.find((v) => v.tableId === tableId && v.isDefault)
    setSeeded({ api, tableId, viewId: view?.id, rows })
  }, [])

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.title}>
          <span className={styles.eyebrow}>Grid demo</span>
          <h1>Companies</h1>
        </div>
        <div className={styles.meta}>
          {seeded ? <span className={styles.count}>{seeded.rows.toLocaleString('en-US')} rows</span> : null}
          <ThemeButton />
        </div>
      </header>
      <section className={styles.gridHost}>
        {seeded ? (
          <TableGridDynamic api={seeded.api} tableId={seeded.tableId} viewId={seeded.viewId} />
        ) : (
          <div className={styles.seeding}>Seeding {TARGET_ROWS.toLocaleString('en-US')} rows…</div>
        )}
      </section>
    </main>
  )
}
