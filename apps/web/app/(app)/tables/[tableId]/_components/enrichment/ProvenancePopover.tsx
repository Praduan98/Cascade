'use client'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { CellRect } from '@cascade/grid'
import { Popover, PopoverAnchor, PopoverContent, ProvenanceCard } from '@cascade/ui'
import type { EnrichStatus } from '@cascade/ui'
import { formatDate } from '../../../../../lib/ui'
import { toProviderRef } from './opMeta'

export interface ProvenanceTarget {
  recordId: string
  columnId: string
  rect: CellRect
}

interface Props {
  target: ProvenanceTarget | null
  workspaceId: string
  canCost: boolean
  onClose: () => void
  onRetry: (recordId: string, columnId: string) => void
}

export function ProvenancePopover({ target, workspaceId, canCost, onClose, onRetry }: Props) {
  const providersQuery = useQuery({
    queryKey: ['enrichment', 'providers', workspaceId],
    queryFn: () => getApi().enrichment.providers.list(workspaceId),
    enabled: !!target,
  })
  const resultsQuery = useQuery({
    queryKey: ['enrichment', 'result', target?.recordId, target?.columnId],
    queryFn: () => getApi().enrichment.results(target!.recordId, target!.columnId),
    enabled: !!target,
  })

  if (!target) return null
  const result = resultsQuery.data?.[0]
  const provider = result?.providerId ? providersQuery.data?.find((p) => p.id === result.providerId) : undefined
  const status = (result?.status ?? 'queued') as EnrichStatus
  const value = result && result.valueJson != null && typeof result.valueJson !== 'object' ? String(result.valueJson) : undefined

  return (
    <Popover
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <PopoverAnchor asChild>
        <div
          style={{
            position: 'absolute',
            left: target.rect.x,
            top: target.rect.y,
            width: target.rect.width,
            height: target.rect.height,
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom">
        <ProvenanceCard
          status={status}
          value={value}
          provider={provider ? toProviderRef(provider) : undefined}
          step={result?.stepIndex != null ? `step ${result.stepIndex + 1}` : undefined}
          at={result ? formatDate(result.fetchedAt) : undefined}
          cost={result && result.credits > 0 ? `${result.credits} cr` : undefined}
          costUsd={canCost && result ? `$${result.providerCostUsd.toFixed(4)}` : undefined}
          fromCache={result?.fromCache}
          confidence={result?.confidence ?? undefined}
          reason={result?.reason}
          onRetry={status === 'failed' ? () => onRetry(target.recordId, target.columnId) : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
