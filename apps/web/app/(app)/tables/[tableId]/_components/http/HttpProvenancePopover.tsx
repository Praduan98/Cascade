'use client'
// Per-cell HTTP provenance popover (US-3.5) — shows the request URL, method,
// response status code, and (for failures) a retry.

import { useQuery } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { CellRect } from '@cascade/grid'
import { Popover, PopoverAnchor, PopoverContent, ProvenanceCard } from '@cascade/ui'
import type { EnrichStatus } from '@cascade/ui'
import { formatDate } from '../../../../../lib/ui'

export interface HttpProvenanceTarget {
  recordId: string
  columnId: string
  rect: CellRect
}

interface Props {
  target: HttpProvenanceTarget | null
  workspaceId: string
  canCost: boolean
  onClose: () => void
  onRetry: (recordId: string, columnId: string) => void
}

export function HttpProvenancePopover({ target, canCost, onClose, onRetry }: Props) {
  const resultsQuery = useQuery({
    queryKey: ['http', 'result', target?.recordId, target?.columnId],
    queryFn: () => getApi().http.results(target!.recordId, target!.columnId),
    enabled: !!target,
  })

  if (!target) return null
  const result = resultsQuery.data?.[0]
  const status = (result?.status ?? 'queued') as EnrichStatus
  const value = result && result.valueJson != null && typeof result.valueJson !== 'object' ? String(result.valueJson) : undefined
  const step = result?.statusCode != null ? `HTTP ${result.statusCode}` : undefined

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
          operation={result?.method}
          promptSnippet={result?.requestUrl}
          step={step}
          at={result ? formatDate(result.fetchedAt) : undefined}
          cost={result && result.credits > 0 ? `${result.credits} cr` : undefined}
          costUsd={canCost && result ? `$${result.providerCostUsd.toFixed(4)}` : undefined}
          fromCache={result?.fromCache}
          reason={result?.reason}
          onRetry={status === 'failed' ? () => onRetry(target.recordId, target.columnId) : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
