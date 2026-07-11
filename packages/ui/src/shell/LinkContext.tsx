'use client'
import { createContext, useContext, type ElementType, type ReactNode } from 'react'

// A link component that behaves like an <a> (accepts href + anchor props).
// Next.js's <Link> satisfies this; the plain 'a' fallback keeps @cascade/ui
// framework-agnostic (no hard `next` dependency) for any other consumer.
export type LinkLike = ElementType

const LinkContext = createContext<LinkLike>('a')

/**
 * Injects the host framework's link component (e.g. Next's <Link>) so the shell
 * navigation performs soft client-side transitions instead of full-page reloads.
 * Wrap the app once; NavItem / TopNavLink pick it up automatically.
 */
export function LinkProvider({ component, children }: { component: LinkLike; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>
}

/** The injected link component, or the plain `'a'` fallback. */
export const useLinkComponent = (): LinkLike => useContext(LinkContext)
