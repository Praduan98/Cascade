import Link from 'next/link'
import { Button, Pill, ThemeButton, type PillStatus } from '@cascade/ui'
import styles from './page.module.css'

const SURFACES: Array<[string, string]> = [
  ['--ground', 'ground'],
  ['--surface', 'surface'],
  ['--surface-2', 'surface-2'],
  ['--surface-3', 'surface-3'],
  ['--border', 'border'],
  ['--brand', 'brand'],
  ['--cobalt', 'cobalt'],
  ['--gold', 'gold'],
]

const STATUS: Array<[PillStatus, string]> = [
  ['queued', 'Queued'],
  ['running', 'Running'],
  ['success', 'Success'],
  ['empty', 'Empty'],
  ['failed', 'Failed'],
  ['cached', 'Cached'],
]

export default function KitchenSink() {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <div className={styles.title}>Component gallery</div>
          <Link href="/" style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>
            ← Cascade
          </Link>
        </div>
        <ThemeButton />
      </header>

      <section className={styles.section}>
        <h2>Color · both themes (toggle top-right)</h2>
        <div className={styles.swatches}>
          {SURFACES.map(([varName, label]) => (
            <div key={varName} className={styles.swatch}>
              <div className={styles.chip} style={{ background: `var(${varName})` }} />
              <div className={styles.meta}>
                <div className={styles.name}>{label}</div>
                <div className={styles.hex}>{varName}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Typography · Bricolage · Hanken · JetBrains Mono</h2>
        <div className={styles.type}>
          <div className={styles.specDisplay}>Enrich, don&rsquo;t guess.</div>
          <div className={styles.specBody}>
            A waterfall runs providers in a defined order and only falls through to the next when the previous returns
            nothing — maximising coverage while minimising spend.
          </div>
          <div className={styles.specMono}>
            jordan@northwind.io &nbsp; 2,480 cr &nbsp; rec_9fK2x7Lp &nbsp; +1 415 555 0132
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Buttons</h2>
        <div className={styles.row}>
          <Button variant="primary">Run enrichment</Button>
          <Button variant="secondary">Add column</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete table</Button>
          <Button variant="primary" size="sm">
            Run
          </Button>
          <Button variant="primary" size="lg">
            Confirm run · 2,480 cr
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Status pills · the enrichment state machine</h2>
        <div className={styles.row}>
          {STATUS.map(([status, label]) => (
            <Pill key={status} status={status}>
              {label}
            </Pill>
          ))}
        </div>
      </section>
    </div>
  )
}
