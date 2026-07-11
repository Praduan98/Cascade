'use client'
import type { MouseEventHandler, ReactNode } from 'react'
import { useLinkComponent } from './LinkContext'
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
  onClick?: MouseEventHandler<HTMLElement>
}

// Ported from architecture.src.html — `.sh-nav a` / `.on`.
export function NavItem({ children, icon, active = false, disabled = false, href, onClick }: NavItemProps) {
  // The host app injects Next's <Link> so internal navigation is a soft client
  // transition (no full-page reload / cache wipe). Falls back to a plain <a>.
  const Link = useLinkComponent()
  const cls = [active ? styles.on : '', disabled ? styles.disabled : ''].filter(Boolean).join(' ')

  // With no href this is an action, not a link — render a real <button> so it is
  // keyboard-operable (Enter/Space) rather than a role="button" <a> that isn't.
  if (!href) {
    return (
      <button
        type="button"
        className={cls || undefined}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
      >
        {icon}
        {children}
      </button>
    )
  }

  // A disabled link doesn't navigate — render a plain, inert <a> (a routed
  // <Link> needs a valid href and would still be focusable/clickable).
  if (disabled) {
    return (
      <a className={cls || undefined} aria-current={active ? 'page' : undefined} aria-disabled tabIndex={-1}>
        {icon}
        {children}
      </a>
    )
  }

  return (
    <Link
      className={cls || undefined}
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {children}
    </Link>
  )
}
