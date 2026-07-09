import Link from 'next/link'
import { ThemeButton } from '@cascade/ui'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.main}>
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

      <div className={styles.hero}>
        <span className="eyebrow">GTM Enrichment · Phase 1 · Frontend</span>
        <h1 style={{ marginTop: 16 }}>
          The data tool that <span className={styles.flow}>flows downhill.</span>
        </h1>
        <p>
          A lean, operator-first spreadsheet wired to a multi-provider enrichment waterfall. This is the Phase 1
          frontend — the foundation grid, typed columns, views, and CSV — built faithfully on the Deep Current design
          system.
        </p>
        <div className={styles.actions}>
          <Link href="/tables" className="btn btn-primary btn-lg">
            Enter the app
          </Link>
          <Link href="/kitchen-sink" className="btn btn-secondary btn-lg">
            View the component gallery
          </Link>
        </div>
      </div>
    </main>
  )
}
