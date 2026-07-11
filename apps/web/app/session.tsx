'use client'
// The client-side session context. On mount it resolves the current mock
// session via getApi().auth.currentSession(), loads the workspaces the user
// belongs to, and computes the acting membership/role for the *active*
// workspace (which is persisted across reloads). Everything the app needs to
// gate UI — user, workspace, role, membership — flows from here.
//
// getApi() is only ever touched inside effects / callbacks (never during
// render) so nothing runs during SSR, where localStorage is absent.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getApi } from '@cascade/data'
import type { Member, Role, User, Workspace } from '@cascade/core'

const ACTIVE_WS_KEY = 'cascade:active-workspace'

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface SessionContextValue {
  status: SessionStatus
  user: User | null
  /** The workspace the app is currently acting within. */
  workspace: Workspace | null
  /** Every workspace the signed-in user is a member of. */
  workspaces: Workspace[]
  /** The acting user's role in the active workspace. */
  role: Role | null
  /** The acting user's membership record in the active workspace. */
  membership: Member | null
  /** Switch the active workspace (client-side; recomputes role + persists). */
  switchWorkspace: (workspaceId: string) => Promise<void>
  /** Demo affordance: act as another seeded user to exercise roles. */
  switchUser: (userId: string) => Promise<void>
  signOut: () => Promise<void>
  /** Re-resolve the session (e.g. after signing in / signing up). */
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function readPersistedWorkspace(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_WS_KEY)
  } catch {
    return null
  }
}
function persistWorkspace(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_WS_KEY, id)
  } catch {
    /* ignore */
  }
}
function clearPersistedWorkspace(): void {
  try {
    window.localStorage.removeItem(ACTIVE_WS_KEY)
  } catch {
    /* ignore */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('')
  const [membership, setMembership] = useState<Member | null>(null)

  const reset = useCallback((next: SessionStatus) => {
    setUser(null)
    setWorkspaces([])
    setActiveWorkspaceId('')
    setMembership(null)
    setStatus(next)
  }, [])

  const load = useCallback(async () => {
    const api = getApi()
    try {
      const session = await api.auth.currentSession()
      if (!session) {
        reset('unauthenticated')
        return
      }
      const wss = await api.workspaces.list()

      // Prefer the persisted workspace, then the session default, then the first.
      const persisted = readPersistedWorkspace()
      let activeId = ''
      if (persisted && wss.some((w) => w.id === persisted)) activeId = persisted
      else if (wss.some((w) => w.id === session.workspaceId)) activeId = session.workspaceId
      else {
        const first = wss[0]
        if (first) activeId = first.id
      }

      let mem: Member | null = null
      if (activeId) {
        const members = await api.members.list(activeId)
        mem = members.find((m) => m.userId === session.user.id) ?? null
      }

      setUser(session.user)
      setWorkspaces(wss)
      setActiveWorkspaceId(activeId)
      setMembership(mem)
      setStatus('authenticated')
      if (activeId) persistWorkspace(activeId)
    } catch {
      reset('unauthenticated')
    }
  }, [reset])

  useEffect(() => {
    void load()
  }, [load])

  // Tracks the latest requested workspace so a slow membership lookup from an
  // earlier switch can't clobber a newer one.
  const switchTargetRef = useRef<string | null>(null)

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!user) return
      if (workspaceId === activeWorkspaceId) return
      if (!workspaces.some((w) => w.id === workspaceId)) return
      // Optimistic: flip the active workspace immediately so the switcher label,
      // topbar, and workspace-scoped queries update on click. Keep the prior
      // membership until the new role resolves (avoids a role-gated UI flicker),
      // then patch it in — ignoring a stale response if the user switched again.
      switchTargetRef.current = workspaceId
      setActiveWorkspaceId(workspaceId)
      persistWorkspace(workspaceId)
      try {
        const members = await getApi().members.list(workspaceId)
        if (switchTargetRef.current !== workspaceId) return
        setMembership(members.find((m) => m.userId === user.id) ?? null)
      } catch {
        /* keep the optimistic switch; role resolves on the next full load */
      }
    },
    [user, activeWorkspaceId, workspaces],
  )

  const switchUser = useCallback(
    async (userId: string) => {
      setStatus('loading')
      await getApi().auth.switchUser(userId)
      // The new identity may not belong to the previously-active workspace, so
      // drop the persisted preference and let load() pick their default.
      clearPersistedWorkspace()
      await load()
    },
    [load],
  )

  const signOut = useCallback(async () => {
    await getApi().auth.signOut()
    clearPersistedWorkspace()
    reset('unauthenticated')
  }, [reset])

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      workspace,
      workspaces,
      role: membership?.role ?? null,
      membership,
      switchWorkspace,
      switchUser,
      signOut,
      refresh: load,
    }),
    [status, user, workspace, workspaces, membership, switchWorkspace, switchUser, signOut, load],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Full session context. Throws if used outside <SessionProvider>. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}

/** The active workspace, the list, and the workspace switcher. */
export function useWorkspace(): {
  workspace: Workspace | null
  workspaces: Workspace[]
  switchWorkspace: (workspaceId: string) => Promise<void>
} {
  const { workspace, workspaces, switchWorkspace } = useSession()
  return { workspace, workspaces, switchWorkspace }
}

/** The acting user's role in the active workspace (null until resolved). */
export function useRole(): Role | null {
  return useSession().role
}
