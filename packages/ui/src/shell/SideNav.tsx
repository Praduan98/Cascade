'use client'
import type { MouseEventHandler, ReactNode } from 'react'
import styles from './shell.module.css'

export function SideNav({ children }: { children: ReactNode }) {
  return <nav className={styles['sh-nav']}>{children}</nav>
}

export function NavGroup({ children }: { children: ReactNode }) {
  return <div className={styles.grp}>{children}</div>
}

interface NavItemProps {
  children: ReactNode
  icon?: ReactNode
  active?: boolean
  disabled?: boolean
  href?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

// Ported from architecture.src.html — `.sh-nav a` / `.on`.
export function NavItem({ children, icon, active = false, disabled = false, href, onClick }: NavItemProps) {
  const cls = [active ? styles.on : '', disabled ? styles.disabled : ''].filter(Boolean).join(' ')
  return (
    <a
      className={cls || undefined}
      href={disabled ? undefined : href}
      onClick={disabled ? undefined : onClick}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      role={href ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
    >
      {icon}
      {children}
    </a>
  )
}
