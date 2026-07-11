import type { ReactNode } from 'react'

interface CollapseProps {
  /** When true the children are revealed; when false they smoothly collapse away. */
  in: boolean
  children?: ReactNode
}

/**
 * Smoothly reveals/hides its children by animating `grid-template-rows 0fr → 1fr`
 * (the sanctioned auto-height reveal — a layout property, used intentionally here)
 * plus opacity. Children stay mounted so the exit animates too, but collapsed
 * content is set `visibility: hidden` (delayed until the collapse finishes) so it
 * leaves the tab order and the accessibility tree — matching the previous
 * unmount-on-hide semantics. Honours the global prefers-reduced-motion reset,
 * which neutralises the transitions and leaves the resting state visible. Drive
 * it only via the `in` prop.
 *
 * Note: not for live-region alerts (role="status"/"alert") — keeping them mounted
 * suppresses the insertion announcement; use a plain conditional for those.
 */
export function Collapse({ in: open, children }: CollapseProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition:
          'grid-template-rows var(--dur-2) var(--ease), opacity var(--dur-2) var(--ease)',
      }}
    >
      <div
        style={{
          minHeight: 0,
          overflow: 'hidden',
          visibility: open ? 'visible' : 'hidden',
          // Hide only after the collapse animation on close; reveal immediately on open.
          transition: open ? 'visibility 0s' : 'visibility 0s var(--dur-2)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
