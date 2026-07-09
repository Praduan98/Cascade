import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

export type ChipTone = 'brand' | 'cobalt' | 'gold' | 'cached'

const TONE: Record<ChipTone, CSSProperties> = {
  brand: {},
  cobalt: { color: 'var(--cobalt)', borderColor: 'var(--cobalt-line)', background: 'var(--cobalt-soft)' },
  gold: { color: 'var(--gold)', borderColor: 'var(--gold-line)', background: 'var(--gold-soft)' },
  cached: {
    color: 'var(--st-cached)',
    borderColor: 'color-mix(in srgb, var(--st-cached) 30%, transparent)',
    background: 'var(--st-cached-soft)',
  },
}

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone
  children?: ReactNode
}

// Uses the global `.chip` primitive (mono, brand-tinted by default). Citation /
// reference chips use the `cobalt` tone in the design.
export function Chip({ tone = 'brand', className = '', style, children, ...rest }: ChipProps) {
  const cls = ['chip', className].filter(Boolean).join(' ')
  return (
    <span className={cls} style={{ ...TONE[tone], ...style }} {...rest}>
      {children}
    </span>
  )
}
