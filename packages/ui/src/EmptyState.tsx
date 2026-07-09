import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  /** Optional icon/illustration slot. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Action slot — typically a Button or two. */
  action?: ReactNode
  className?: string
}

// Built from the Deep Current design language (no dedicated markup in the
// source): a centred, calm placeholder for empty tables / views / lists.
export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      {icon != null && <div className={styles.icon}>{icon}</div>}
      <div className={styles.title}>{title}</div>
      {description != null && <p className={styles.desc}>{description}</p>}
      {action != null && <div className={styles.action}>{action}</div>}
    </div>
  )
}
