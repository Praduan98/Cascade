'use client'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell, ThemeButton, Topbar } from '@cascade/ui'
import { useSession } from '../session'
import { Sidebar } from './_components/Sidebar'
import { UserMenu } from './_components/UserMenu'
import { CreditChip } from './_components/CreditChip'
import { VerifyBanner } from './_components/VerifyBanner'
import { OnboardingGate } from './_components/OnboardingGate'
import styles from './app-shell.module.css'

// The authenticated shell. Redirects to /sign-in when there is no session, and
// otherwise frames every app page with the Topbar, sidebar nav, and the
// verify-email banner.
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, user, workspace } = useSession()
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/sign-in')
  }, [status, router])

  // Close the mobile nav drawer on Escape.
  useEffect(() => {
    if (!navOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  // Move focus into the drawer on open; restore it to the hamburger on close.
  useEffect(() => {
    if (navOpen) {
      drawerRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus()
    } else if (wasOpen.current) {
      hamburgerRef.current?.focus()
    }
    wasOpen.current = navOpen
  }, [navOpen])

  // Keep Tab focus inside the open drawer (it is aria-modal).
  function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const items = drawerRef.current?.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!items || items.length === 0) return
    const list = Array.from(items)
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  if (status !== 'authenticated') {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} role="status" aria-label="Loading" />
      </div>
    )
  }

  const unverified = !!user && !user.emailVerified

  return (
    <div className={styles.root}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <Topbar
        brand="Cascade"
        sub={workspace?.name}
        actions={
          <div className={styles.topActions}>
            <button
              ref={hamburgerRef}
              type="button"
              className={styles.mobileNavBtn}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls={navOpen ? 'mobile-nav-drawer' : undefined}
              onClick={() => setNavOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <CreditChip />
            <ThemeButton />
            <UserMenu />
          </div>
        }
      />
      {unverified && user && <VerifyBanner email={user.email} />}
      <OnboardingGate />
      <div className={styles.body}>
        <AppShell sidebar={<Sidebar />}>{children}</AppShell>
      </div>
      {navOpen && (
        <div className={styles.drawerOverlay} onClick={() => setNavOpen(false)}>
          <div
            ref={drawerRef}
            id="mobile-nav-drawer"
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onKeyDown={trapFocus}
            onClick={(e) => {
              e.stopPropagation()
              // Following a nav link should dismiss the drawer.
              if ((e.target as HTMLElement).closest('a[href]')) setNavOpen(false)
            }}
          >
            <button
              type="button"
              className={styles.drawerClose}
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <Sidebar />
          </div>
        </div>
      )}
    </div>
  )
}
