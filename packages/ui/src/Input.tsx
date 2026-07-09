import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import styles from './Input.module.css'

/** Validation tone applied to a typed input/textarea. */
export type InputState = 'ok' | 'err'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  state?: InputState
}

// Ported from design-system.src.html — `.input` (+ `.ok` / `.err`).
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { state, className = '', ...rest },
  ref,
) {
  const cls = [styles.input, state ? styles[state] : '', className].filter(Boolean).join(' ')
  return <input ref={ref} className={cls} {...rest} />
})

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  state?: InputState
}

// `.input` styling on a textarea, matching `textarea.input` in the design.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { state, className = '', rows = 3, ...rest },
  ref,
) {
  const cls = [styles.input, styles.area, state ? styles[state] : '', className].filter(Boolean).join(' ')
  return <textarea ref={ref} className={cls} rows={rows} {...rest} />
})
