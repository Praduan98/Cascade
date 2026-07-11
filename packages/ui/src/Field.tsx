import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  /** Field label text. */
  label?: ReactNode
  /** Mono type badge shown next to the label, e.g. "URL" / "Email" / "Number". */
  type?: ReactNode
  /** Helper text shown under the control. */
  hint?: ReactNode
  /** Render the hint in the error tone (also flags the control `aria-invalid`). */
  error?: boolean
  /** Associates the label with a control id. */
  htmlFor?: string
  /** The control (Input, Textarea, Select, …). */
  children: ReactNode
  className?: string
}

/** Props Field injects into its single control child so label + hint bind correctly. */
type Injectable = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

// Ported from design-system.src.html `.field` (label + mono `.ty` badge + `.hint`/`.hint.err`).
// The label is associated with the control by injecting an id; when a `hint` is present it is
// also wired via `aria-describedby`, and an `error` sets `aria-invalid` + announces the hint,
// so screen readers get the label, the helper text, and the invalid state.
export function Field({ label, type, hint, error, htmlFor, children, className = '' }: FieldProps) {
  const autoId = useId()
  const hintId = useId()
  const childProps: Injectable = isValidElement(children)
    ? ((children as ReactElement<Injectable>).props ?? {})
    : {}
  const controlId = htmlFor ?? childProps.id ?? autoId
  const describedBy =
    hint != null
      ? [childProps['aria-describedby'], hintId].filter(Boolean).join(' ')
      : childProps['aria-describedby']

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Injectable>, {
        id: controlId,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : childProps['aria-invalid'],
      })
    : children

  const cls = [styles.field, className].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {label != null && (
        <label htmlFor={controlId}>
          {label}
          {type != null && <span className={styles.ty}>{type}</span>}
        </label>
      )}
      {control}
      {hint != null && (
        <span
          id={hintId}
          role={error ? 'alert' : undefined}
          className={[styles.hint, error ? styles.err : ''].filter(Boolean).join(' ')}
        >
          {hint}
        </span>
      )}
    </div>
  )
}
