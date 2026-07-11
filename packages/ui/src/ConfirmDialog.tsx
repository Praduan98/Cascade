'use client'
import { useState, type ReactNode } from 'react'
import { Dialog, DialogClose } from './Dialog'
import { Button } from './Button'

interface ConfirmDialogProps {
  /** Element that opens the dialog (rendered via asChild). Omit for controlled use. */
  trigger?: ReactNode
  /** Controlled open state. Omit to let the component manage its own state via `trigger`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Optional extra body content shown above the actions. */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm action as destructive (danger) instead of primary. */
  danger?: boolean
  /** Runs on confirm; if it returns a promise the confirm button shows a spinner
   *  and the dialog closes only after it resolves. */
  onConfirm: () => void | Promise<void>
}

// Confirmation dialog for destructive / irreversible actions, built on the shared
// Dialog. Handles async confirm (spinner + close-on-success) and works either
// controlled (`open`/`onOpenChange`) or trigger-driven.
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const actualOpen = isControlled ? open : internalOpen

  const setOpen = (o: boolean) => {
    if (!isControlled) setInternalOpen(o)
    onOpenChange?.(o)
  }

  const handleConfirm = async () => {
    try {
      setBusy(true)
      await onConfirm()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      trigger={trigger}
      open={actualOpen}
      onOpenChange={(o) => {
        if (!busy) setOpen(o)
      }}
      title={title}
      description={description}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
