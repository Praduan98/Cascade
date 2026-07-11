'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { canManageAutomations, canManageIntegrations, canManageProviders, canManageSubscription, canViewAudit, canWrite } from '@cascade/core'
import {
  NavGroup,
  NavItem,
  SideNav,
  WorkspaceSwitcher,
} from '@cascade/ui'
import { useSession } from '../../session'
import { CreateTableDialog } from './CreateTableDialog'
import styles from '../app-shell.module.css'

// ---- Tiny inline stroke icons (styled to 15px by shell.module.css) ----
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const TableIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 4v16" />
  </Icon>
)
const GridIcon = () => (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Icon>
)
const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
const MembersIcon = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  </Icon>
)
const AuditIcon = () => (
  <Icon>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h4" />
  </Icon>
)
const UsageIcon = () => (
  <Icon>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 4-5" />
  </Icon>
)
const ProvidersIcon = () => (
  <Icon>
    <path d="M4 7h10M4 12h16M4 17h7" />
  </Icon>
)
const BillingIcon = () => (
  <Icon>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </Icon>
)
const AutomationIcon = () => (
  <Icon>
    <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
  </Icon>
)
const IntegrationIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Icon>
)
const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 8.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 12z" />
  </Icon>
)
const CheckIcon = () => (
  <svg className={styles.wsCheck} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

function WorkspaceMenu() {
  const { workspace, workspaces, switchWorkspace } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.wsWrap} ref={ref}>
      <WorkspaceSwitcher name={workspace?.name ?? 'Workspace'} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className={styles.wsMenu} role="menu">
          {workspaces.map((ws) => {
            const active = ws.id === workspace?.id
            return (
              <button
                key={ws.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={styles.wsItem}
                onClick={() => {
                  void switchWorkspace(ws.id)
                  setOpen(false)
                }}
              >
                <span className={styles.wsDot} />
                <span className={styles.wsName}>{ws.name}</span>
                {active && <CheckIcon />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { workspace, role } = useSession()
  const pathname = usePathname()
  const [createOpen, setCreateOpen] = useState(false)

  const writable = role ? canWrite(role) : false
  const auditable = role ? canViewAudit(role) : false
  const providersOk = role ? canManageProviders(role) : false
  const billingOk = role ? canManageSubscription(role) : false
  const automationsOk = role ? canManageAutomations(role) : false
  const integrationsOk = role ? canManageIntegrations(role) : false

  const tablesQuery = useQuery({
    queryKey: ['tables', workspace?.id],
    queryFn: () => getApi().tables.list(workspace!.id),
    enabled: !!workspace,
  })
  const tables = tablesQuery.data ?? []

  return (
    <>
      <WorkspaceMenu />
      <SideNav>
        <NavGroup>Tables</NavGroup>
        {tables.map((t) => (
          <NavItem
            key={t.id}
            href={`/tables/${t.id}`}
            active={pathname === `/tables/${t.id}`}
            icon={<TableIcon />}
          >
            {t.name}
          </NavItem>
        ))}
        {tablesQuery.isLoading && <span className={styles.navHint}>Loading…</span>}
        {!tablesQuery.isLoading && tables.length === 0 && (
          <span className={styles.navHint}>No tables yet</span>
        )}
        <NavItem href="/tables" active={pathname === '/tables'} icon={<GridIcon />}>
          All tables
        </NavItem>
        {writable && (
          <NavItem
            icon={<PlusIcon />}
            onClick={(e) => {
              e.preventDefault()
              setCreateOpen(true)
            }}
          >
            New table
          </NavItem>
        )}

        <NavGroup>Workspace</NavGroup>
        <NavItem href="/members" active={pathname === '/members'} icon={<MembersIcon />}>
          Members
        </NavItem>
        {auditable && (
          <NavItem href="/audit" active={pathname === '/audit'} icon={<AuditIcon />}>
            Audit
          </NavItem>
        )}
        {providersOk && (
          <NavItem href="/providers" active={pathname === '/providers'} icon={<ProvidersIcon />}>
            Providers &amp; keys
          </NavItem>
        )}
        {automationsOk && (
          <NavItem href="/automations" active={pathname === '/automations'} icon={<AutomationIcon />}>
            Automations
          </NavItem>
        )}
        {integrationsOk && (
          <NavItem href="/integrations" active={pathname === '/integrations'} icon={<IntegrationIcon />}>
            Integrations
          </NavItem>
        )}
        <NavItem href="/usage" active={pathname === '/usage'} icon={<UsageIcon />}>
          Usage &amp; credits
        </NavItem>
        {billingOk && (
          <NavItem href="/billing" active={pathname === '/billing'} icon={<BillingIcon />}>
            Billing &amp; plans
          </NavItem>
        )}
        <NavItem href="/settings" active={pathname === '/settings'} icon={<SettingsIcon />}>
          Settings
        </NavItem>
      </SideNav>

      {workspace && (
        <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspace.id} />
      )}
    </>
  )
}
