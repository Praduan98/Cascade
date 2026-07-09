'use client'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type Resolved = 'light' | 'dark'

interface ThemeCtx {
  theme: Theme
  resolved: Resolved
  setTheme: (t: Theme) => void
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({
  theme: 'system',
  resolved: 'dark',
  setTheme: () => {},
  toggle: () => {},
})

const STORAGE_KEY = 'cascade-theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Default 'system'; the pre-hydration no-flash script may already have set
  // document.documentElement.dataset.theme, which we reconcile on mount.
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolved, setResolved] = useState<Resolved>('dark')

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') setThemeState(stored)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const r: Resolved = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme
      setResolved(r)
      const root = document.documentElement
      if (theme === 'system') delete root.dataset.theme
      else root.dataset.theme = theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setTheme(resolved === 'light' ? 'dark' : 'light')
  }, [resolved, setTheme])

  return <Ctx.Provider value={{ theme, resolved, setTheme, toggle }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
