'use client'
// The superadmin platform area — a sibling route segment of (app), so it gets
// its own shell and is NOT wrapped by the workspace shell. Gated entirely on the
// separate platform session (FR-4.2): non-staff never reach it via a workspace
// role, and the /admin/login route renders bare (outside the gate).

import { useEffect, type ReactNode } from 'react'
import { AdminGateSkeleton } from './_components/AdminGateSkeleton'
import { usePathname, useRouter } from 'next/navigation'
import { PlatformSessionProvider, usePlatformSession } from './PlatformSession'
import { AdminShell } from './_components/AdminShell'

function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { status } = usePlatformSession()
  const router = useRouter()
  const isLogin = pathname === '/admin/login'

  useEffect(() => {
    if (isLogin && status === 'authenticated') router.replace('/admin')
    if (!isLogin && status === 'unauthenticated') router.replace('/admin/login')
  }, [status, isLogin, router])

  if (isLogin) return <>{children}</>

  if (status !== 'authenticated') {
    return <AdminGateSkeleton />
  }
  return <AdminShell>{children}</AdminShell>
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformSessionProvider>
      <AdminGate>{children}</AdminGate>
    </PlatformSessionProvider>
  )
}
