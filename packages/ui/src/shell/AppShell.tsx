import type { ReactNode } from 'react'
import styles from './shell.module.css'

interface AppShellProps {
  /** Left column — typically <WorkspaceSwitcher/> + <SideNav/>. */
  sidebar: ReactNode
  /** Main working area. */
  children: ReactNode
  className?: string
}

// Ported from architecture.src.html — `.shell` (sidebar + main grid).
export function AppShell({ sidebar, children, className = '' }: AppShellProps) {
  return (
    <div className={[styles.shell, className].filter(Boolean).join(' ')}>
      <aside className={styles['sh-side']}>{sidebar}</aside>
      {/* tabIndex=-1 so the skip-to-content link moves focus here (not just scroll). */}
      <main id="main" tabIndex={-1} className={styles['sh-main']}>
        {children}
      </main>
    </div>
  )
}
