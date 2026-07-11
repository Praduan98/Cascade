'use client'
// Guided-onboarding trigger (US-4.12). On genuine first-run — the active
// workspace's onboarding is still `pending` AND it has no tables yet — this
// redirects to /onboarding. It never fires for an established workspace, and
// never when already on the onboarding route, so there's no redirect loop.
// Onboarding is skippable + revisitable (Settings → "Replay onboarding").

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { useSession } from '../../session'

export function OnboardingGate() {
  const { status, workspace } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const wsId = workspace?.id

  const onboardingQuery = useQuery({
    queryKey: ['onboarding', wsId],
    queryFn: () => getApi().onboarding.get(wsId!),
    enabled: status === 'authenticated' && !!wsId,
  })
  const tablesQuery = useQuery({
    queryKey: ['tables', wsId],
    queryFn: () => getApi().tables.list(wsId!),
    enabled: status === 'authenticated' && !!wsId,
  })

  useEffect(() => {
    if (pathname?.startsWith('/onboarding')) return
    const ob = onboardingQuery.data
    const tables = tablesQuery.data
    if (!ob || !tables) return
    if (ob.status === 'pending' && tables.length === 0) {
      router.replace('/onboarding')
    }
  }, [onboardingQuery.data, tablesQuery.data, pathname, router])

  return null
}
