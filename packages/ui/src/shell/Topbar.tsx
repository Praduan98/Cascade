import type { ReactNode } from 'react'
import { BrandGlyph } from './BrandGlyph'
import styles from './shell.module.css'

interface TopbarProps {
  /** Brand wordmark text. Defaults to "Cascade". */
  brand?: ReactNode
  /** Small mono pill next to the wordmark, e.g. "Phase 1". */
  sub?: ReactNode
  /** Center nav slot (typically Topbar links). */
  nav?: ReactNode
  /** Right-aligned actions (e.g. <ThemeButton/>, user menu). */
  actions?: ReactNode
  className?: string
}

// Ported from architecture.src.html — `.topbar` + `.brand`.
export function Topbar({ brand = 'Cascade', sub, nav, actions, className = '' }: TopbarProps) {
  return (
    <header className={[styles.topbar, className].filter(Boolean).join(' ')}>
      <div className={styles.brand}>
        <BrandGlyph className={styles.glyph} />
        {brand}
        {sub != null && <span className={styles.sub}>{sub}</span>}
      </div>
      <div className={styles.spacer} />
      {nav != null && <nav className={styles.topnav}>{nav}</nav>}
      {actions}
    </header>
  )
}
