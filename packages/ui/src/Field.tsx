import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  /** Field label text. */
  label?: ReactNode
  /** Mono type badge shown next to the label, e.g. "URL" / "Email" / "Number". */
  type?: ReactNode
  /** Helper text shown under the control. */
  hint?: ReactNode
  /** Render the hint in the error tone. */
  error?: boolean
  /** Associates the label with a control id. */
  htmlFor?: string
  /** The control (Input, Select, Switch, …). */
  children: ReactNode
  className?: string
}

// Ported from design-system.src.html `.field` (label + mono `.ty` badge + `.hint`/`.hint.err`).
export function Field({ label, type, hint, error, htmlFor, children, className = '' }: FieldProps) {
  const autoId = useId()
  const controlId = htmlFor ?? autoId
  // Associate the label with the control: inject an id into the single control
  // child (unless it already has one) so <label htmlFor> binds it — screen
  // readers announce the label and clicking it focuses the input.
  const control =
    isValidElement(children) && (children as ReactElement<{ id?: string }>).props.id === undefined
      ? cloneElement(children as ReactElement<{ id?: string }>, { id: controlId })
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
        <span className={[styles.hint, error ? styles.err : ''].filter(Boolean).join(' ')}>{hint}</span>
      )}
    </div>
  )
}
