import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

// Uses the global primitive classes shipped by the token layer (.btn, .btn-*).
// forwardRef so it composes as a Radix `asChild` trigger/close element.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', children, ...rest },
  ref,
) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  )
})
