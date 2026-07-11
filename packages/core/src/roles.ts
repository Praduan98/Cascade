// Role helpers — the authority ladder and the capability predicates the UI uses
// to hide controls and the mock API uses to enforce guards. Framework-agnostic.

import type { Plan, PlanTier, PlatformRole, Role } from './types'

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

// --- Enrichment (Phase 2) --------------------------------------------------

/** Can build enrichment columns and trigger runs (US-2.1 / US-2.4). */
export function canRunEnrichment(role: Role): boolean {
  return canWrite(role)
}

/** Can manage provider credentials and the credit budget (US-2.11 / US-2.13). */
export function canManageBilling(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

/** Can view/enter provider keys (US-2.13). */
export function canManageProviders(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

/** Can see real provider cost / margin behind credits (US-2.12). */
export function canViewMargin(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

// --- Automation + integrations (Phase 3) -----------------------------------

/** Can create/edit/enable automations — schedules, triggers, webhooks (US-3.7–3.10). */
export function canManageAutomations(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

/** Can connect/configure external integrations — CRM, Slack (US-3.12–3.14). */
export function canManageIntegrations(role: Role): boolean {
  return hasAtLeast(role, 'admin')
}

// --- SaaS billing + plans (Phase 4) ----------------------------------------

/** Plan tiers in upgrade order (lower = cheaper); drives proration direction. */
export const PLAN_RANK: Record<PlanTier, number> = { free: 0, starter: 1, growth: 2, scale: 3 }

/** Owner-only: the subscription / plan / invoices / top-up surface (US-4.1/4.3/4.4). */
export function canManageSubscription(role: Role): boolean {
  return hasAtLeast(role, 'owner')
}

/** True when adding another seat would exceed the plan's seat limit (US-4.14). */
export function seatsExceeded(plan: Plan | null | undefined, seatsUsed: number): boolean {
  if (!plan) return false
  return seatsUsed >= plan.seatLimit
}

// --- Platform superadmin RBAC (Phase 4; NEVER a workspace role, FR-4.2) -----

export const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = { support: 0, admin: 1 }
export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { support: 'Support', admin: 'Platform Admin' }

export function platformHasAtLeast(role: PlatformRole, min: PlatformRole): boolean {
  return PLATFORM_ROLE_RANK[role] >= PLATFORM_ROLE_RANK[min]
}

/** Support+ can view workspaces, analytics, and the platform audit log. */
export function canViewPlatform(role: PlatformRole): boolean {
  return platformHasAtLeast(role, 'support')
}

/** Admin-only: suspend/reactivate workspaces, deactivate users (US-4.5). */
export function canOperateWorkspaces(role: PlatformRole): boolean {
  return platformHasAtLeast(role, 'admin')
}

/** Admin-only: refunds, comp credits, plan overrides (US-4.6). */
export function canIssueBillingExceptions(role: PlatformRole): boolean {
  return platformHasAtLeast(role, 'admin')
}
