import type { HTMLAttributes, ReactNode } from 'react'

interface KbdProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
}

// Uses the global `kbd` element styling from the token layer.
export function Kbd({ children, ...rest }: KbdProps) {
  return <kbd {...rest}>{children}</kbd>
}
