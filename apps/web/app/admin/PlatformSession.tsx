'use client'
// A SEPARATE session track for platform staff (FR-4.2) — never derived from a
// workspace role. Mirrors the workspace `session.tsx` pattern but resolves
// `platform.auth.currentSession()`. The mock store persists the platform session
// independently of the workspace session.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getApi } from '@cascade/data'
import type { PlatformUser } from '@cascade/core'

type Status = 'loading' | 'authenticated' | 'unauthenticated'

interface PlatformCtx {
  status: Status
  platformUser: PlatformUser | null
  signIn: (email: string, password?: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<PlatformCtx | null>(null)

export function PlatformSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [platformUser, setPlatformUser] = useState<PlatformUser | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await getApi().platform.auth.currentSession()
      if (s) {
        setPlatformUser(s.platformUser)
        setStatus('authenticated')
      } else {
        setPlatformUser(null)
        setStatus('unauthenticated')
      }
    } catch {
      setPlatformUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const signIn = useCallback(async (email: string, password?: string) => {
    const s = await getApi().platform.auth.signIn(email, password)
    setPlatformUser(s.platformUser)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    await getApi().platform.auth.signOut()
    setPlatformUser(null)
    setStatus('unauthenticated')
  }, [])

  return <Ctx.Provider value={{ status, platformUser, signIn, signOut, refresh: load }}>{children}</Ctx.Provider>
}

export function usePlatformSession(): PlatformCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePlatformSession must be used within a PlatformSessionProvider')
  return c
}
