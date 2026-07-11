'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import { Tag } from '@cascade/ui'
import { useSession } from '../../session'

// A compact workspace credit-balance chip in the top bar, linking to /usage.
// Shows credits (not money) to all roles; turns amber when the budget is spent.
export function CreditChip() {
  const { workspace } = useSession()
  const q = useQuery({
    queryKey: ['credits', 'balance', workspace?.id],
    queryFn: () => getApi().credits.balance(workspace!.id),
    enabled: !!workspace,
    staleTime: 15_000,
  })
  if (!workspace) return null
  const balance = q.data?.balance
  const paused = q.data?.paused ?? false
  // Paused/over-budget must not be signalled by tone (gold) alone — add a text
  // label so the state is legible without relying on colour.
  return (
    <Link
      href="/usage"
      aria-label={paused ? 'Usage & credits — budget paused' : 'Usage & credits'}
      title={paused ? 'Credit budget paused — top up to resume' : 'Workspace credit balance'}
      style={{ textDecoration: 'none' }}
    >
      <Tag mono tone={paused ? 'gold' : 'default'}>
        {balance == null ? '…' : `${balance.toLocaleString('en-US')} cr`}
        {paused && ' · paused'}
      </Tag>
    </Link>
  )
}
