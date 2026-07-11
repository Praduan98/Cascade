import Link from 'next/link'
import { ThemeButton } from '@cascade/ui'
import styles from './page.module.css'

// A small provider glyph used in the hero visual — mono initials on a tinted chip.
function Prov({ mono, color }: { mono: string; color: string }) {
  return (
    <span className={styles.prov} style={{ background: color }}>
      {mono}
    </span>
  )
}

export default function Home() {
  return (
    <>
      <header className={styles.top}>
        <div className={styles.brand}>
          <svg className={styles.glyph} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M4 7h24M7 13.5h18M10 20h12M13 26.5h6" stroke="url(#cg)" strokeWidth="2.6" strokeLinecap="round" />
            <defs>
              <linearGradient id="cg" x1="4" y1="7" x2="28" y2="27" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2fe6c8" />
                <stop offset="1" stopColor="#6c9bff" />
              </linearGradient>
            </defs>
          </svg>
          Cascade
        </div>
        <ThemeButton />
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.copy}>
            <span className={`eyebrow ${styles.eyebrow} ${styles.r1}`}>Waterfall enrichment for GTM teams</span>
            <h1 className={`${styles.headline} ${styles.r2}`}>
              The data tool that <span className={styles.flow}>flows downhill.</span>
            </h1>
            <p className={`${styles.lede} ${styles.r3}`}>
              A lean, operator-first spreadsheet wired to a multi-provider enrichment waterfall. Maximise coverage,
              minimise spend, and see exactly where every value came from.
            </p>
            <div className={`${styles.actions} ${styles.r4}`}>
              <Link href="/home" className="btn btn-primary btn-lg">
                Start enriching
              </Link>
            </div>
            <div className={`${styles.trust} ${styles.r5}`}>
              <span className={styles.trustLabel}>Providers, in one waterfall</span>
              <div className={styles.trustRow}>
                <Prov mono="PD" color="#2563eb" />
                <Prov mono="Hu" color="#c2410c" />
                <Prov mono="Pr" color="#7c3aed" />
                <Prov mono="ZB" color="#047857" />
              </div>
            </div>
          </div>

          <div className={`${styles.visual} ${styles.r5}`} aria-hidden="true">
            <div className={styles.gridCard}>
              <div className={styles.gridHead}>
                <span className={styles.gridName}>Q3 Targets</span>
                <span className={styles.gridCount}>1,240 rows</span>
              </div>
              <div className={styles.gridRow}>
                <span className={styles.cellCo}>Northwind</span>
                <span className={styles.cellVal}>jordan@northwind.io</span>
                <span className={`${styles.stat} ${styles.ok}`}>Enriched</span>
              </div>
              <div className={styles.gridRow}>
                <span className={styles.cellCo}>Balto Freight</span>
                <span className={styles.cellVal}>rosa@baltofreight.co</span>
                <span className={`${styles.stat} ${styles.cached}`}>Cached</span>
              </div>
              <div className={styles.gridRow}>
                <span className={styles.cellCo}>Meridian AI</span>
                <span className={styles.cellVal}>resolving…</span>
                <span className={`${styles.stat} ${styles.running}`}>Running</span>
              </div>
              <div className={styles.gridRow}>
                <span className={styles.cellCo}>Kestrel Labs</span>
                <span className={styles.cellValMuted}>no match</span>
                <span className={`${styles.stat} ${styles.empty}`}>Empty</span>
              </div>
            </div>

            <div className={styles.meterCard}>
              <div className={styles.meterCap}>
                <span>Credits this run</span>
                <span className={styles.meterVal}>2,480 cr</span>
              </div>
              <div className={styles.meterTrack}>
                <div className={styles.meterFill} />
              </div>
            </div>

            <div className={styles.flowCard}>
              <span className={styles.flowStep}>
                <Prov mono="PD" color="#2563eb" /> enrich
              </span>
              <span className={styles.flowArrow}>fall through if empty</span>
              <span className={styles.flowStep}>
                <Prov mono="Hu" color="#c2410c" /> find
              </span>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
