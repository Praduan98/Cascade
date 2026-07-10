'use client'
import * as PO from '@radix-ui/react-popover'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import styles from './Popover.module.css'

export const Popover = PO.Root
export const PopoverTrigger = PO.Trigger
export const PopoverClose = PO.Close

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof PO.Content> & { showArrow?: boolean }
>(function PopoverContent({ className = '', sideOffset = 8, showArrow = true, children, ...rest }, ref) {
  return (
    <PO.Portal>
      <PO.Content
        ref={ref}
        sideOffset={sideOffset}
        className={[styles.content, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
        {showArrow && <PO.Arrow className={styles.arrow} width={12} height={6} />}
      </PO.Content>
    </PO.Portal>
  )
})
