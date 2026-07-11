'use client'
import type { MouseEventHandler, ReactNode } from 'react'
import { useLinkComponent } from './LinkContext'
import styles from './shell.module.css'

interface TopNavLinkProps {
  children: ReactNode
  href?: string
  active?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

// A single link inside the Topbar `nav` slot (styled `.topnav a`). Routes through
// the injected Next <Link> for soft navigation; plain <a> when there's no href.
export function TopNavLink({ children, href, active = false, onClick }: TopNavLinkProps) {
  const Link = useLinkComponent()
  const className = active ? styles.active : undefined
  const ariaCurrent = active ? 'page' : undefined
  if (!href) {
    return (
      <a onClick={onClick} className={className} aria-current={ariaCurrent}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} onClick={onClick} className={className} aria-current={ariaCurrent}>
      {children}
    </Link>
  )
}
