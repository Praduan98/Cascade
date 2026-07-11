'use client'
// Connect-sequencer dialog (US-4.10): provider + account label + write-only
// token. The token is sent once and never returned — the API stores only a
// masked hint (`••••1234`). Mirrors ConnectCrmDialog.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { SequencerProvider } from '@cascade/core'
import { Button, Dialog, DialogClose, Field, Input, Select, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'
import styles from '../integrations.module.css'

const SEQ_LABEL: Record<SequencerProvider, string> = {
  instantly: 'Instantly',
  smartlead: 'Smartlead',
  heyreach: 'HeyReach',
}

export function ConnectSequencerDialog(props: {
  open: boolean
  onOpenChange: (o: boolean) => void
  workspaceId: string
  onConnected: () => void
}) {
  const { open, onOpenChange, workspaceId, onConnected } = props
  const { toast } = useToast()
  const [provider, setProvider] = useState<SequencerProvider>('instantly')
  const [accountLabel, setAccountLabel] = useState('')
  const [token, setToken] = useState('')

  function reset() {
    setProvider('instantly')
    setAccountLabel('')
    setToken('')
  }

  const connect = useMutation({
    mutationFn: () =>
      getApi().integration.sequencers.connect(workspaceId, {
        provider,
        token: token.trim(),
        accountLabel: accountLabel.trim(),
      }),
    onSuccess: () => {
      toast(`Connected ${SEQ_LABEL[provider]}`, { variant: 'success' })
      onConnected()
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast(errorMessage(e, 'Could not connect the sequencer'), { variant: 'error' }),
  })

  const canSubmit = !!token.trim() && !connect.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="Connect a sequencer"
      description="Push enriched lists into Instantly, Smartlead, or HeyReach. The API token is stored securely and never shown again."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => connect.mutate()} disabled={!canSubmit}>
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <Field label="Provider" htmlFor="seq-provider">
          <Select
            id="seq-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as SequencerProvider)}
          >
            <option value="instantly">Instantly</option>
            <option value="smartlead">Smartlead</option>
            <option value="heyreach">HeyReach</option>
          </Select>
        </Field>
        <Field label="Account label" htmlFor="seq-account" hint="A name to recognise this connection.">
          <Input
            id="seq-account"
            placeholder="Acme outbound"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
          />
        </Field>
      </div>

      <Field label="API token (required)" htmlFor="seq-token" hint="Stored securely and never shown again.">
        <Input
          id="seq-token"
          type="password"
          autoComplete="off"
          placeholder="Paste the sequencer API token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
    </Dialog>
  )
}
