'use client'
import * as RD from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import styles from './Dialog.module.css'

interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Element that opens the dialog (rendered via asChild). */
  trigger?: ReactNode
  title?: ReactNode
  description?: ReactNode
  /** Footer slot — typically Cancel / Confirm buttons. */
  footer?: ReactNode
  children?: ReactNode
  /** Accessible label used when no visible `title` is provided. */
  ariaLabel?: string
  className?: string
}

// Radix Dialog styled from design-system.src.html `.modal-demo`.
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  footer,
  children,
  ariaLabel = 'Dialog',
  className = '',
}: DialogProps) {
  return (
    <RD.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger != null && <RD.Trigger asChild>{trigger}</RD.Trigger>}
      <RD.Portal>
        <RD.Overlay className={styles.overlay} />
        <RD.Content className={[styles.content, className].filter(Boolean).join(' ')}>
          {title != null ? (
            <div className={styles.head}>
              <RD.Title className={styles.title}>{title}</RD.Title>
              {description != null && <RD.Description className={styles.desc}>{description}</RD.Description>}
            </div>
          ) : (
            <RD.Title className={styles.srOnly}>{ariaLabel}</RD.Title>
          )}
          {children != null && <div className={styles.body}>{children}</div>}
          {footer != null && <div className={styles.foot}>{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}

// Low-level parts for custom compositions.
export const DialogRoot = RD.Root
export const DialogTrigger = RD.Trigger
export const DialogClose = RD.Close
