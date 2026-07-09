import type { HTMLAttributes, ReactNode } from 'react'

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

// Uses the global `.card` primitive (elevated surface, shadow-2).
export function Card({ className = '', children, ...rest }: SurfaceProps) {
  const cls = ['card', className].filter(Boolean).join(' ')
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}

// Uses the global `.panel` primitive (flat inset surface).
export function Panel({ className = '', children, ...rest }: SurfaceProps) {
  const cls = ['panel', className].filter(Boolean).join(' ')
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}
