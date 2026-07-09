'use client'
import * as DM from '@radix-ui/react-dropdown-menu'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import styles from './DropdownMenu.module.css'

export const DropdownMenu = DM.Root
export const DropdownMenuTrigger = DM.Trigger
export const DropdownMenuGroup = DM.Group

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DM.Content>
>(function DropdownMenuContent({ className = '', sideOffset = 6, children, ...rest }, ref) {
  return (
    <DM.Portal>
      <DM.Content
        ref={ref}
        sideOffset={sideOffset}
        className={[styles.content, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  )
})

interface ItemProps extends ComponentPropsWithoutRef<typeof DM.Item> {
  /** Danger tone for destructive actions. */
  danger?: boolean
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, ItemProps>(function DropdownMenuItem(
  { className = '', danger = false, ...rest },
  ref,
) {
  const cls = [styles.item, danger ? styles.danger : '', className].filter(Boolean).join(' ')
  return <DM.Item ref={ref} className={cls} {...rest} />
})

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DM.Separator>
>(function DropdownMenuSeparator({ className = '', ...rest }, ref) {
  return <DM.Separator ref={ref} className={[styles.sep, className].filter(Boolean).join(' ')} {...rest} />
})

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DM.Label>
>(function DropdownMenuLabel({ className = '', ...rest }, ref) {
  return <DM.Label ref={ref} className={[styles.label, className].filter(Boolean).join(' ')} {...rest} />
})
