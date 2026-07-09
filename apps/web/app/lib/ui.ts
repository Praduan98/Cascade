// Small presentation helpers shared across the app shell and feature screens.
import { isApiError } from '@cascade/data'

/** Human-readable message for any thrown value, preferring our ApiError copy. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(e)) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/** Up-to-two-letter initials from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase()
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase()
}

/** e.g. "Jun 1, 2026". Falls back to the raw string if it can't be parsed. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
