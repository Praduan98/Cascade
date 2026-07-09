'use client'
import type { MouseEventHandler, ReactNode } from 'react'
import styles from './shell.module.css'

interface WorkspaceSwitcherProps {
  name: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
}

// Ported from architecture.src.html — `.sh-ws` / `.wsq` / `.wsn`.
export function WorkspaceSwitcher({ name, onClick, className = '' }: WorkspaceSwitcherProps) {
  return (
    <button
      type="button"
      className={[styles['sh-ws'], className].filter(Boolean).join(' ')}
      onClick={onClick}
      aria-label="Switch workspace"
    >
      <span className={styles.wsq} />
      <span className={styles.wsn}>{name}</span>
      <svg
        className={styles.wscaret}
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
  )
}
