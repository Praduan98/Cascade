'use client'
import type { MouseEventHandler, ReactNode } from 'react'
import styles from './shell.module.css'

interface TopNavLinkProps {
  children: ReactNode
  href?: string
  active?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

// A single link inside the Topbar `nav` slot (styled `.topnav a`).
export function TopNavLink({ children, href, active = false, onClick }: TopNavLinkProps) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={active ? styles.active : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </a>
  )
}
