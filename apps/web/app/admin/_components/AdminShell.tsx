'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavGroup, NavItem, SideNav, ThemeButton, Topbar, Tag } from '@cascade/ui'
import { PLATFORM_ROLE_LABELS } from '@cascade/core'
import { usePlatformSession } from '../PlatformSession'
import styles from '../admin.module.css'

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 4-5" />
    </svg>
  )
}
function WorkspacesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="8" height="12" rx="1" /><rect x="13" y="4" width="8" height="16" rx="1" />
    </svg>
  )
}
function AuditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" />
    </svg>
  )
}

const NAV = [
  { href: '/admin', label: 'Overview', icon: <OverviewIcon /> },
  { href: '/admin/workspaces', label: 'Workspaces', icon: <WorkspacesIcon /> },
  { href: '/admin/audit', label: 'Platform audit', icon: <AuditIcon /> },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { platformUser, signOut } = usePlatformSession()

  return (
    <div className={styles.root}>
      <Topbar
        className={styles.topbar}
        brand="Cascade"
        sub="Superadmin"
        nav={<Tag mono tone="gold">platform</Tag>}
        actions={
          <>
            <button type="button" className={['btn btn-ghost btn-sm', styles.topbarSignOut].join(' ')} onClick={() => void signOut()}>Sign out</button>
            <ThemeButton />
          </>
        }
      />
      {/* Mobile nav — the sidebar is hidden <=720px, so surface nav + sign-out here. */}
      <nav className={styles.mobileNav} aria-label="Platform navigation">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={[styles.mobileNavItem, pathname === n.href ? styles.mobileNavActive : ''].filter(Boolean).join(' ')} aria-current={pathname === n.href ? 'page' : undefined}>
            {n.icon}
            <span>{n.label}</span>
          </Link>
        ))}
        <Link href="/tables" className={styles.mobileNavItem}>← Back to app</Link>
      </nav>
      <div className={styles.body}>
        <aside className={styles.side}>
          <div className={styles.sideBrand}>
            <span className={styles.sideGlyph}><ShieldIcon /></span>
            <span className={styles.sideTitle}>
              <b>Cascade</b>
              <span>Platform</span>
            </span>
          </div>
          <SideNav>
            <NavGroup>Operate</NavGroup>
            <NavItem href="/admin" active={pathname === '/admin'} icon={<OverviewIcon />}>Overview</NavItem>
            <NavItem href="/admin/workspaces" active={pathname === '/admin/workspaces'} icon={<WorkspacesIcon />}>Workspaces</NavItem>
            <NavItem href="/admin/audit" active={pathname === '/admin/audit'} icon={<AuditIcon />}>Platform audit</NavItem>
          </SideNav>
          <div className={styles.sideFoot}>
            {platformUser && (
              <div className={styles.who}>
                <span className={styles.whoName}>
                  <b>{platformUser.name}</b>
                  <span>{PLATFORM_ROLE_LABELS[platformUser.platformRole]}</span>
                </span>
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out</button>
            <Link href="/tables" className="btn btn-ghost btn-sm">← Back to app</Link>
          </div>
        </aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  )
}
