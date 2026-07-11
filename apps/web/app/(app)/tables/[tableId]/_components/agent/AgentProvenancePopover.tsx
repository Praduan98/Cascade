'use client'
// Per-cell agent provenance popover (US-3.4) — the analog of AiProvenancePopover,
// with cited sources + steps/pages. Anchors an invisible Radix popover to the
// clicked canvas cell.

import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { CellRect } from '@cascade/grid'
import { Popover, PopoverAnchor, PopoverContent, ProvenanceCard } from '@cascade/ui'
import type { EnrichStatus } from '@cascade/ui'
import { formatDate } from '../../../../../lib/ui'

export interface AgentProvenanceTarget {
  recordId: string
  columnId: string
  rect: CellRect
}

interface Props {
  target: AgentProvenanceTarget | null
  workspaceId: string
  canCost: boolean
  onClose: () => void
  onRetry: (recordId: string, columnId: string) => void
}

export function AgentProvenancePopover({ target, workspaceId, canCost, onClose, onRetry }: Props) {
  const modelsQuery = useQuery({
    queryKey: ['agent', 'models', workspaceId],
    queryFn: () => getApi().agent.models.list(workspaceId),
    enabled: !!target,
  })
  const resultsQuery = useQuery({
    queryKey: ['agent', 'result', target?.recordId, target?.columnId],
    queryFn: () => getApi().agent.results(target!.recordId, target!.columnId),
    enabled: !!target,
  })

  if (!target) return null
  const result = resultsQuery.data?.[0]
  const model = result?.modelKey ? modelsQuery.data?.find((m) => m.key === result.modelKey) : undefined
  const status = (result?.status ?? 'queued') as EnrichStatus
  const value = result && result.valueJson != null && typeof result.valueJson !== 'object' ? String(result.valueJson) : undefined
  const step = result ? `${result.steps} step${result.steps === 1 ? '' : 's'} · ${result.pages} page${result.pages === 1 ? '' : 's'}` : undefined

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
          model={model?.label}
          operation="research"
          promptSnippet={result?.objectiveResolved}
          sources={result?.sources}
          step={step}
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
