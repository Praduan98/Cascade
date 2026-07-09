import type { ReactNode } from 'react'
import styles from './Member.module.css'

interface MemberProps {
  /** Usually an <Avatar/>. */
  avatar: ReactNode
  name: ReactNode
  email: ReactNode
  /** Right-aligned slot — typically a <RoleBadge/> or an actions menu. */
  action?: ReactNode
  /** Removes the bottom hairline (use on the last row). */
  last?: boolean
  className?: string
}

// Ported from design-system.src.html — `.member` row.
export function Member({ avatar, name, email, action, last = false, className = '' }: MemberProps) {
  const cls = [styles.member, last ? styles.last : '', className].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {avatar}
      <span className={styles.who}>
        <div className={styles.nm}>{name}</div>
        <div className={styles.em}>{email}</div>
      </span>
      {action}
    </div>
  )
}
