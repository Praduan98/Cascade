import type { ReactNode } from 'react'
import styles from './RoleBadge.module.css'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

const LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

interface RoleBadgeProps {
  role: Role
  children?: ReactNode
}

// Ported from design-system.src.html — `.role-badge` (owner/admin/member/viewer).
export function RoleBadge({ role, children }: RoleBadgeProps) {
  const cls = [styles['role-badge'], styles[`role-${role}`]].filter(Boolean).join(' ')
  return <span className={cls}>{children ?? LABEL[role]}</span>
}
