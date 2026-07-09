'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../lib/ui'

interface CreateTableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

// Shared create-table dialog used by both the sidebar ("New table") and the
// tables list page, so the create flow lives in exactly one place.
export function CreateTableDialog({ open, onOpenChange, workspaceId }: CreateTableDialogProps) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const mutation = useMutation({
    mutationFn: (tableName: string) => getApi().tables.create(workspaceId, { name: tableName }),
    onSuccess: (table) => {
      void qc.invalidateQueries({ queryKey: ['tables', workspaceId] })
      toast(`Created “${table.name}”`, { variant: 'success' })
      onOpenChange(false)
    },
    onError: (err) => toast(errorMessage(err, 'Could not create table'), { variant: 'error' }),
  })

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !mutation.isPending

  function submit() {
    if (!canSubmit) return
    mutation.mutate(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New table"
      description="Give your table a name. It starts with a single text column you can build on."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {mutation.isPending ? 'Creating…' : 'Create table'}
          </Button>
        </>
      }
    >
      <Field label="Table name" htmlFor="new-table-name">
        <Input
          id="new-table-name"
          autoFocus
          placeholder="e.g. Companies"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      </Field>
    </Dialog>
  )
}
