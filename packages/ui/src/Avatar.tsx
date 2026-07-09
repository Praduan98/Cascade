import type { CSSProperties } from 'react'
import styles from './Avatar.module.css'

interface AvatarProps {
  /** Initials shown inside the circle. */
  initials: string
  /** Background colour (a token var or hex). Ignored when `dashed`. */
  bg?: string
  /** Text colour. */
  color?: string
  /** Dashed-outline placeholder look used for pending / invited members. */
  dashed?: boolean
  size?: number
  className?: string
  style?: CSSProperties
}

// Ported from design-system.src.html — `.avatar`.
export function Avatar({ initials, bg = 'var(--brand)', color, dashed = false, size, className = '', style }: AvatarProps) {
  const base: CSSProperties = dashed
    ? { background: 'transparent', border: '1px dashed var(--border-strong)', color: color ?? 'var(--text-3)' }
    : { background: bg, color: color ?? 'var(--brand-ink)' }
  const sized: CSSProperties = size ? { width: size, height: size } : {}
  return (
    <span className={[styles.avatar, className].filter(Boolean).join(' ')} style={{ ...base, ...sized, ...style }}>
      {initials}
    </span>
  )
}
