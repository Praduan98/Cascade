'use client'
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

  if (!user) return null

  async function onSwitch(userId: string) {
    try {
      await switchUser(userId)
      router.replace('/tables')
    } catch (err) {
      toast(errorMessage(err, 'Could not switch account'), { variant: 'error' })
    }
  }

  async function onSignOut() {
    try {
      await signOut()
    } finally {
      router.replace('/sign-in')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={styles.userBtn} aria-label="Account menu">
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
              disabled={isCurrent}
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
        <DropdownMenuItem danger onSelect={() => void onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
