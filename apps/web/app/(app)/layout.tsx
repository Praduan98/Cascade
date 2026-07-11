'use client'
import { useEffect, type ReactNode } from 'react'
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

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/sign-in')
  }, [status, router])

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
      <Topbar
        brand="Cascade"
        sub={workspace?.name}
        actions={
          <div className={styles.topActions}>
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
    </div>
  )
}
