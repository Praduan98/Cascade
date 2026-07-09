'use client'
import styles from './Switch.module.css'

interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

// Ported from design-system.src.html — `.switch` / `.switch.on`.
// Rendered as a real button with role="switch" for keyboard + a11y.
export function Switch({ checked = false, onCheckedChange, disabled = false, id, ...aria }: SwitchProps) {
  const cls = [styles.switch, checked ? styles.on : ''].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      className={cls}
      onClick={() => onCheckedChange?.(!checked)}
      {...aria}
    />
  )
}
