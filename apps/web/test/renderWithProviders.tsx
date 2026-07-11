// A render helper that mounts a component inside the app's real provider stack
// (react-query + Theme + Tooltip + Toast, and optionally the Session context)
// with a fresh, isolated MockApi injected behind getApi().
//
// A `beforeEach` (registered when this module is imported by a test file) swaps
// in a brand-new MockApi per test — latency disabled for speed and a unique
// storageKey so tests never share localStorage-backed state. Access it via the
// returned `api`, or `getTestApi()`.

import { type ReactElement, type ReactNode } from 'react'
import { beforeEach } from 'vitest'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, ToastProvider, TooltipProvider } from '@cascade/ui'
import { createMockApi, setApi, type MockApi } from '@cascade/data'
import { SessionProvider } from '../app/session'

let seq = 0
let currentApi: MockApi

/** The MockApi installed behind getApi() for the current test. */
export function getTestApi(): MockApi {
  return currentApi
}

// Fresh, isolated data layer for every test.
beforeEach(() => {
  currentApi = createMockApi({ latency: false, storageKey: `cascade-test-${Date.now()}-${seq++}` })
  setApi(currentApi)
})

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Wrap in the real SessionProvider (defaults to true). Set false for
   * components that don't consume the session, to avoid async session noise. */
  session?: boolean
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
  api: MockApi
}

export function renderWithProviders(
  ui: ReactElement,
  { session = true, ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    const body = session ? <SessionProvider>{children}</SessionProvider> : children
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider delayDuration={0}>
            <ToastProvider>{body}</ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }

  const result = render(ui, { wrapper: Wrapper, ...options })
  return { ...result, queryClient, api: currentApi }
}
