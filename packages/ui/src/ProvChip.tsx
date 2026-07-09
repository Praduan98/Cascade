import type { CSSProperties, ReactNode } from 'react'
import styles from './ProvChip.module.css'

interface ProvMonoProps {
  /** Two-letter provider glyph. */
  children: ReactNode
  /** Background colour (hex or token var). */
  bg?: string
  color?: string
  style?: CSSProperties
  className?: string
}

// Ported from design-system.src.html — `.prov-mono` (the coloured provider square).
export function ProvMono({ children, bg = 'var(--surface-3)', color = '#fff', style, className = '' }: ProvMonoProps) {
  return (
    <span
      className={[styles['prov-mono'], className].filter(Boolean).join(' ')}
      style={{ background: bg, color, ...style }}
    >
      {children}
    </span>
  )
}

interface ProvChipProps {
  /** Two-letter provider glyph rendered in the coloured square. */
  mono: ReactNode
  bg?: string
  color?: string
  /** Provider display name. */
  children: ReactNode
  className?: string
}

// Ported from design-system.src.html — `.prov-chip` (square + provider name).
export function ProvChip({ mono, bg, color, children, className = '' }: ProvChipProps) {
  return (
    <span className={[styles['prov-chip'], className].filter(Boolean).join(' ')}>
      <ProvMono bg={bg} color={color}>
        {mono}
      </ProvMono>
      {children}
    </span>
  )
}
