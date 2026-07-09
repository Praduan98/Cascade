import type { ReactNode } from 'react'
import styles from './Alert.module.css'

export type AlertVariant = 'info' | 'success' | 'warn' | 'error'

const ICON: Record<AlertVariant, string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '✕',
}

interface AlertProps {
  variant?: AlertVariant
  /** Bold heading line. */
  title?: ReactNode
  children?: ReactNode
  className?: string
}

// Ported from design-system.src.html — `.alert` (info/success/warn/error, left
// border + tinted icon).
export function Alert({ variant = 'info', title, children, className = '' }: AlertProps) {
  const cls = [styles.alert, styles[`alert-${variant}`], className].filter(Boolean).join(' ')
  return (
    <div className={cls} role="status">
      <span className={styles.ico} aria-hidden="true">
        {ICON[variant]}
      </span>
      <span className={styles.msg}>
        {title != null && <span className={styles.h}>{title}</span>}
        {children != null && <p>{children}</p>}
      </span>
    </div>
  )
}
