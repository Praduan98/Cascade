'use client'
import * as TP from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export const TooltipProvider = TP.Provider

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  delayDuration?: number
}

// Radix Tooltip styled in the Deep Current language. Requires a <TooltipProvider>
// ancestor (mount one near the app root).
export function Tooltip({ content, children, side = 'top', sideOffset = 6, delayDuration = 200 }: TooltipProps) {
  return (
    <TP.Root delayDuration={delayDuration}>
      <TP.Trigger asChild>{children}</TP.Trigger>
      <TP.Portal>
        <TP.Content side={side} sideOffset={sideOffset} className={styles.content}>
          {content}
          <TP.Arrow className={styles.arrow} width={11} height={5} />
        </TP.Content>
      </TP.Portal>
    </TP.Root>
  )
}
