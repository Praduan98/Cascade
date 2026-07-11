'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RoleBadge,
  useToast,
} from '@cascade/ui'
import { useSession } from '../../session'
import { DEMO_USERS } from '../../lib/demo-users'
import { errorMessage, initials } from '../../lib/ui'
import styles from '../app-shell.module.css'

export function UserMenu() {
  const { user, membership, switchUser, signOut } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  // Keep the account trigger in a pending/disabled state through the
  // navigation + destination fetch that follows a switch or sign-out, so the
  // control signals progress and can't be re-triggered during the dead time.
  const [isNavigating, startNavigation] = useTransition()

  if (!user) return null

  async function onSwitch(userId: string) {
    try {
      await switchUser(userId)
      startNavigation(() => router.replace('/tables'))
    } catch (err) {
      toast(errorMessage(err, 'Could not switch account'), { variant: 'error' })
    }
  }

  async function onSignOut() {
    try {
      await signOut()
    } finally {
      startNavigation(() => router.replace('/sign-in'))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={styles.userBtn}
          aria-label="Account menu"
          aria-busy={isNavigating || undefined}
          data-loading={isNavigating || undefined}
        >
          <Avatar initials={initials(user.name)} size={28} />
          <span className={styles.userName}>{user.name}</span>
          <svg
            className={styles.userCaret}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.menu}>
        <div className={styles.menuHeader}>
          <div className={styles.menuName}>{user.name}</div>
          <div className={styles.menuEmail}>{user.email}</div>
          {membership && (
            <span className={styles.menuBadge}>
              <RoleBadge role={membership.role} />
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Switch account (demo)</DropdownMenuLabel>
        {DEMO_USERS.map((u) => {
          const isCurrent = u.id === user.id
          return (
            <DropdownMenuItem
              key={u.id}
              disabled={isCurrent || isNavigating}
              onSelect={() => {
                if (!isCurrent) void onSwitch(u.id)
              }}
            >
              <span className={styles.switchRow}>
                <Avatar initials={initials(u.name)} size={22} />
                <span className={styles.switchWho}>
                  <span className={styles.switchName}>{u.name}</span>
                  <span className={styles.switchRole}>{u.roleLabel}</span>
                </span>
                {isCurrent && <span className={styles.current}>current</span>}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem danger disabled={isNavigating} onSelect={() => void onSignOut()}>
          {isNavigating ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
