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
      <div className={styles['sh-main']}>{children}</div>
    </div>
  )
}
