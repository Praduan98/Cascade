'use client'
// Connect-Slack dialog (US-3.14): a write-only bot token + team name + default
// channel. The token is stored masked and never returned to the client.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { Button, Dialog, DialogClose, Field, Input, useToast } from '@cascade/ui'
import { errorMessage } from '../../../lib/ui'

export interface ConnectSlackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onConnected: () => void
}

export function ConnectSlackDialog({ open, onOpenChange, workspaceId, onConnected }: ConnectSlackDialogProps) {
  const { toast } = useToast()
  const [token, setToken] = useState('')
  const [teamName, setTeamName] = useState('')
  const [defaultChannel, setDefaultChannel] = useState('')

  function reset() {
    setToken('')
    setTeamName('')
    setDefaultChannel('')
  }

  const connect = useMutation({
    mutationFn: () =>
      getApi().integration.slack.connect(workspaceId, {
        token: token.trim(),
        teamName: teamName.trim(),
        defaultChannel: defaultChannel.trim(),
      }),
    onSuccess: () => {
      toast('Slack connected', { variant: 'success' })
      onConnected()
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast(errorMessage(e, 'Could not connect Slack'), { variant: 'error' }),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="Connect Slack"
      description="Send alerts and automation notifications to a channel. The bot token is stored securely and never shown again."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => connect.mutate()} disabled={!token.trim() || connect.isPending}>
            {connect.isPending ? 'Connecting…' : 'Connect Slack'}
          </Button>
        </>
      }
    >
      <Field label="Bot token" htmlFor="slack-token" hint="Stored securely and never shown again.">
        <Input
          id="slack-token"
          type="password"
          autoComplete="off"
          placeholder="xoxb-…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
      <Field label="Team name" htmlFor="slack-team" hint="Displayed on the connection.">
        <Input id="slack-team" placeholder="Acme" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
      </Field>
      <Field label="Default channel" htmlFor="slack-channel" hint="Where notifications post unless overridden.">
        <Input
          id="slack-channel"
          placeholder="#gtm-signals"
          value={defaultChannel}
          onChange={(e) => setDefaultChannel(e.target.value)}
        />
      </Field>
    </Dialog>
  )
}
