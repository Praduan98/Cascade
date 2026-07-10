import type { ReactNode } from 'react'
import Link from 'next/link'
import { BrandGlyph, ThemeButton } from '@cascade/ui'
import styles from './auth.module.css'

// Centred brand chrome for the mock auth screens (sign in / up / magic link /
// verify). The individual pages render a <Card> inside this frame.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.wrap}>
      <div className={styles.themeToggle}>
        <ThemeButton />
      </div>
      <div className={styles.column}>
        <Link href="/sign-in" className={styles.brand} aria-label="Cascade home">
          <BrandGlyph size={30} />
          <span>Cascade</span>
        </Link>
        {children}
        <p className={styles.foot}>
          Phase 1 · a mock, frontend-only demo. No real accounts or email are involved.
        </p>
      </div>
    </main>
  )
}
