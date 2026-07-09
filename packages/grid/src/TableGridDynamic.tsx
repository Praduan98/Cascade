'use client'
// SSR-off wrapper. Glide Data Grid touches `window`/canvas at import time, so
// it must never run on the server. Consumers render <TableGridDynamic .../> and
// get client-only mounting (plus code-splitting of the grid bundle) for free.

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { TableGridProps } from './TableGrid'

export const TableGridDynamic: ComponentType<TableGridProps> = dynamic(
  () => import('./TableGrid').then((m) => m.TableGrid),
  { ssr: false, loading: () => null },
)
