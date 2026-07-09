// Role helpers — the authority ladder and the capability predicates the UI uses
// to hide controls and the mock API uses to enforce guards. Framework-agnostic.

import type { Role } from './types'

/** Higher rank = more authority. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export function hasAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

/** Can create/edit/delete tables, columns, records, cells, views. */
export function canWrite(role: Role): boolean {
  return hasAtLeast(role, 'member')
}

/** Can invite/remove members and change roles. */
export function canManageMembers(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

/** Can view the workspace audit log. */
export function canViewAudit(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

/** Can transfer ownership / delete the workspace. */
export function canManageWorkspace(role: Role): boolean {
  return hasAtLeast(role, 'owner')
}
