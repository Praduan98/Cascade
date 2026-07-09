import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

export type TagTone = 'default' | 'brand' | 'cobalt' | 'gold' | 'cached' | 'success'

const TONE: Record<TagTone, CSSProperties> = {
  default: {},
  brand: { color: 'var(--brand)', borderColor: 'var(--brand-line)', background: 'var(--brand-soft)' },
  cobalt: { color: 'var(--cobalt)', borderColor: 'var(--cobalt-line)', background: 'var(--cobalt-soft)' },
  gold: { color: 'var(--gold)', borderColor: 'var(--gold-line)', background: 'var(--gold-soft)' },
  cached: {
    color: 'var(--st-cached)',
    borderColor: 'color-mix(in srgb, var(--st-cached) 30%, transparent)',
    background: 'var(--st-cached-soft)',
  },
  success: {
    color: 'var(--st-success)',
    borderColor: 'color-mix(in srgb, var(--st-success) 30%, transparent)',
    background: 'var(--st-success-soft)',
  },
}

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone
  /** Use the mono numeric font (matches `.tag.mono` in the design). */
  mono?: boolean
  children?: ReactNode
}

// Uses the global `.tag` primitive from the token layer; `tone` maps to the
// select-option colour treatments used across the design system. forwardRef so
// it composes as a Radix `asChild` trigger.
export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { tone = 'default', mono = false, className = '', style, children, ...rest },
  ref,
) {
  const cls = ['tag', mono ? 'mono' : '', className].filter(Boolean).join(' ')
  return (
    <span ref={ref} className={cls} style={{ ...TONE[tone], ...style }} {...rest}>
      {children}
    </span>
  )
})
