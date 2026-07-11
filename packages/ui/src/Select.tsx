import { forwardRef, type SelectHTMLAttributes } from 'react'
import type { InputState } from './Input'
import styles from './Select.module.css'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  state?: InputState
}

// Ported from design-system.src.html — `.select` (native select + custom SVG caret).
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { state, className = '', children, ...rest },
  ref,
) {
  const cls = [styles.select, state ? styles[state] : '', className].filter(Boolean).join(' ')
  return (
    <select ref={ref} className={cls} aria-invalid={state === 'err' ? true : undefined} {...rest}>
      {children}
    </select>
  )
})
