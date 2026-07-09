'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './Toast.module.css'

export type ToastVariant = 'default' | 'success' | 'warn' | 'error'

export interface ToastOptions {
  variant?: ToastVariant
  /** Auto-dismiss delay in ms. */
  duration?: number
}

interface ToastItem {
  id: number
  message: ReactNode
  variant: ToastVariant
  duration: number
}

interface ToastCtx {
  toast: (message: ReactNode, opts?: ToastOptions) => void
}

const Ctx = createContext<ToastCtx>({ toast: () => {} })

export function useToast(): ToastCtx {
  return useContext(Ctx)
}

let counter = 0

// Ported from design-system.src.html — `.copytoast` (the bottom-centre toast).
// Extended into a small stack + provider with enter/exit transitions.
export function ToastProvider({ children, duration = 2600 }: { children: ReactNode; duration?: number }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: ReactNode, opts?: ToastOptions) => {
      const id = ++counter
      setItems((list) => [
        ...list,
        { id, message, variant: opts?.variant ?? 'default', duration: opts?.duration ?? duration },
      ])
    },
    [duration],
  )

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onClose={() => remove(item.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [show, setShow] = useState(false)
  const closed = useRef(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true))
    const timer = setTimeout(() => setShow(false), item.duration)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [item.duration])

  const onTransitionEnd = () => {
    // When the exit transition (show -> false) completes, unmount.
    if (!show && !closed.current) {
      closed.current = true
      onClose()
    }
  }

  const cls = [styles.toast, show ? styles.show : '', item.variant !== 'default' ? styles[item.variant] : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} role="status" onTransitionEnd={onTransitionEnd}>
      {item.message}
    </div>
  )
}
