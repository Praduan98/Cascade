'use client'
// The table surface — the product's centrepiece. Loads the table meta, columns
// and views through getApi(), frames the grid with a live toolbar, and mounts
// @cascade/grid's TableGridDynamic (which owns inline editing, the persistent
// add-row, frozen columns and last-write-wins conflict handling). Column and row
// management live at this level: adding/renaming/retyping/reordering/freezing/
// deleting columns and bulk-deleting rows, each re-mounting the grid so its
// canvas reflects the change. Viewers get a read-only grid and disabled
// mutations; the API also enforces this and those 403s surface as toasts.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi, isApiError } from '@cascade/data'
import { canViewMargin, canWrite } from '@cascade/core'
import type { Column, View } from '@cascade/core'
import { TableGridDynamic, type TableGridHandle } from '@cascade/grid'
import { Alert, Button, Dialog, DialogClose, EmptyState, useToast } from '@cascade/ui'
import { useSession } from '../../../session'
import { errorMessage } from '../../../lib/ui'
import { GridToolbar } from './_components/GridToolbar'
import { AddColumnDialog } from './_components/AddColumnDialog'
import { EditColumnDialog } from './_components/EditColumnDialog'
import { ManageColumnsDialog } from './_components/ManageColumnsDialog'
import { BulkDeleteDialog } from './_components/BulkDeleteDialog'
import { WaterfallBuilder } from './_components/enrichment/WaterfallBuilder'
import { RunDialog } from './_components/enrichment/RunDialog'
import { RunProgress } from './_components/enrichment/RunProgress'
import { ProvenancePopover } from './_components/enrichment/ProvenancePopover'
import type { ProvenanceTarget } from './_components/enrichment/ProvenancePopover'
import { AiColumnBuilder } from './_components/ai/AiColumnBuilder'
import { AiProvenancePopover } from './_components/ai/AiProvenancePopover'
import type { AiProvenanceTarget } from './_components/ai/AiProvenancePopover'
import { AgentColumnBuilder } from './_components/agent/AgentColumnBuilder'
import { AgentProvenancePopover } from './_components/agent/AgentProvenancePopover'
import type { AgentProvenanceTarget } from './_components/agent/AgentProvenancePopover'
import { HttpColumnBuilder } from './_components/http/HttpColumnBuilder'
import { HttpProvenancePopover } from './_components/http/HttpProvenancePopover'
import type { HttpProvenanceTarget } from './_components/http/HttpProvenancePopover'
import { FormulaColumnBuilder } from './_components/formula/FormulaColumnBuilder'
import type { ColumnType } from '@cascade/core'
import styles from './table-surface.module.css'

function ColumnGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}

export default function TableSurfacePage() {
  const params = useParams<{ tableId: string }>()
  const tableId = params.tableId
  const { role, workspace } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const writable = role ? canWrite(role) : false
  const canCost = role ? canViewMargin(role) : false

  const [gridKey, setGridKey] = useState(0)
  const [activeViewId, setActiveViewId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Column | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Column | null>(null)

  // Enrichment (Phase 2) surface state.
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderColumn, setBuilderColumn] = useState<Column | null>(null)
  const [runOpen, setRunOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [selection, setSelection] = useState<{ recordIds: string[]; count: number }>({ recordIds: [], count: 0 })
  const [provTarget, setProvTarget] = useState<ProvenanceTarget | null>(null)

  // AI columns (Phase 3) surface state.
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false)
  const [aiBuilderColumn, setAiBuilderColumn] = useState<Column | null>(null)
  const [aiSeedName, setAiSeedName] = useState('')
  const [aiRunOpen, setAiRunOpen] = useState(false)
  const [aiActiveRunId, setAiActiveRunId] = useState<string | null>(null)
  const [aiProvTarget, setAiProvTarget] = useState<AiProvenanceTarget | null>(null)

  // Agent / HTTP / formula columns (Phase 3 rest) surface state.
  const [agentBuilderOpen, setAgentBuilderOpen] = useState(false)
  const [agentBuilderColumn, setAgentBuilderColumn] = useState<Column | null>(null)
  const [agentSeedName, setAgentSeedName] = useState('')
  const [agentRunOpen, setAgentRunOpen] = useState(false)
  const [agentActiveRunId, setAgentActiveRunId] = useState<string | null>(null)
  const [agentProvTarget, setAgentProvTarget] = useState<AgentProvenanceTarget | null>(null)

  const [httpBuilderOpen, setHttpBuilderOpen] = useState(false)
  const [httpBuilderColumn, setHttpBuilderColumn] = useState<Column | null>(null)
  const [httpSeedName, setHttpSeedName] = useState('')
  const [httpRunOpen, setHttpRunOpen] = useState(false)
  const [httpActiveRunId, setHttpActiveRunId] = useState<string | null>(null)
  const [httpProvTarget, setHttpProvTarget] = useState<HttpProvenanceTarget | null>(null)

  const [formulaBuilderOpen, setFormulaBuilderOpen] = useState(false)
  const [formulaBuilderColumn, setFormulaBuilderColumn] = useState<Column | null>(null)
  const [formulaSeedName, setFormulaSeedName] = useState('')

  const metaQuery = useQuery({
    queryKey: ['table', tableId],
    queryFn: () => getApi().tables.get(tableId),
    enabled: !!tableId,
  })

  const columnsQuery = useQuery({
    queryKey: ['columns', tableId],
    queryFn: () => getApi().columns.list(tableId),
    enabled: !!tableId,
  })

  const viewsQuery = useQuery({
    queryKey: ['views', tableId],
    queryFn: () => getApi().views.list(tableId),
    enabled: !!tableId,
  })

  const columns = useMemo(
    () => (columnsQuery.data ? columnsQuery.data.slice().sort((a, b) => a.position - b.position) : []),
    [columnsQuery.data],
  )
  const views = useMemo(() => viewsQuery.data ?? [], [viewsQuery.data])

  const configsQuery = useQuery({
    queryKey: ['enrichment', 'configs', tableId],
    queryFn: () => getApi().enrichment.configs.list(tableId),
    enabled: !!tableId,
  })
  const enrichmentColumnIds = useMemo(() => (configsQuery.data ?? []).map((c) => c.columnId), [configsQuery.data])
  const enrichmentColumns = useMemo(() => columns.filter((c) => enrichmentColumnIds.includes(c.id)), [columns, enrichmentColumnIds])

  const aiConfigsQuery = useQuery({
    queryKey: ['ai', 'configs', tableId],
    queryFn: () => getApi().ai.configs.list(tableId),
    enabled: !!tableId,
  })
  const aiColumnIds = useMemo(() => (aiConfigsQuery.data ?? []).map((c) => c.columnId), [aiConfigsQuery.data])
  const aiColumns = useMemo(() => columns.filter((c) => aiColumnIds.includes(c.id)), [columns, aiColumnIds])

  const agentConfigsQuery = useQuery({
    queryKey: ['agent', 'configs', tableId],
    queryFn: () => getApi().agent.configs.list(tableId),
    enabled: !!tableId,
  })
  const agentColumnIds = useMemo(() => (agentConfigsQuery.data ?? []).map((c) => c.columnId), [agentConfigsQuery.data])
  const agentColumns = useMemo(() => columns.filter((c) => agentColumnIds.includes(c.id)), [columns, agentColumnIds])

  const httpConfigsQuery = useQuery({
    queryKey: ['http', 'configs', tableId],
    queryFn: () => getApi().http.configs.list(tableId),
    enabled: !!tableId,
  })
  const httpColumnIds = useMemo(() => (httpConfigsQuery.data ?? []).map((c) => c.columnId), [httpConfigsQuery.data])
  const httpColumns = useMemo(() => columns.filter((c) => httpColumnIds.includes(c.id)), [columns, httpColumnIds])

  const formulaConfigsQuery = useQuery({
    queryKey: ['formula', 'configs', tableId],
    queryFn: () => getApi().formula.list(tableId),
    enabled: !!tableId,
  })
  const formulaColumnIds = useMemo(() => (formulaConfigsQuery.data ?? []).map((c) => c.columnId), [formulaConfigsQuery.data])

  // Resolve the active view once views load: prefer a valid ?view= from the URL,
  // then the table's default view, then the first.
  useEffect(() => {
    if (views.length === 0) return
    if (activeViewId && views.some((v) => v.id === activeViewId)) return
    let target: View | undefined
    try {
      const urlView = new URLSearchParams(window.location.search).get('view')
      if (urlView) target = views.find((v) => v.id === urlView)
    } catch {
      /* SSR / no window */
    }
    if (!target) target = views.find((v) => v.isDefault) ?? views[0]
    if (target) setActiveViewId(target.id)
  }, [views, activeViewId])

  // Reflect the active view in the URL (?view=<id>) so it's shareable and
  // survives reload. history.replaceState keeps it out of the back-stack and
  // avoids a router round-trip.
  useEffect(() => {
    if (!activeViewId) return
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('view') !== activeViewId) {
        url.searchParams.set('view', activeViewId)
        window.history.replaceState(window.history.state, '', url.toString())
      }
    } catch {
      /* SSR / no window */
    }
  }, [activeViewId])

  const effectiveViewId = activeViewId || undefined

  const rowCountQuery = useQuery({
    queryKey: ['rowCount', tableId, effectiveViewId],
    queryFn: () => getApi().records.count(tableId, effectiveViewId),
    enabled: !!tableId,
  })

  // Live run wiring: subscribe to enrichment events for this table. Per-cell
  // transitions are patched into the grid in place via its imperative handle
  // (no full reload → no shimmer flash on unrelated rows/columns); a run terminal
  // does one reconciling reload and refreshes credits / run history.
  const gridHandleRef = useRef<TableGridHandle | null>(null)
  useEffect(() => {
    if (!activeRunId) return
    const api = getApi()
    const unsub = api.enrichment.subscribe({ tableId }, (e) => {
      if (e.type === 'cell') gridHandleRef.current?.applyEnrichment(e.recordId, e.columnId, e.meta, e.value)
      if (e.type === 'run' && (e.run.status === 'complete' || e.run.status === 'failed' || e.run.status === 'paused')) {
        setRefreshToken((t) => t + 1)
        void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspace?.id] })
        void qc.invalidateQueries({ queryKey: ['enrichment', 'runs', workspace?.id] })
      }
    })
    return () => unsub()
  }, [activeRunId, tableId, qc, workspace?.id])

  function handleRunStarted(runId: string) {
    setActiveRunId(runId)
    setRefreshToken((t) => t + 1)
  }

  function handleRetryCell(recordId: string, columnId: string) {
    setProvTarget(null)
    getApi()
      .enrichment.run(tableId, { mode: 'selected', recordIds: [recordId], columnIds: [columnId] }, { forceFresh: true })
      .then(({ runId }) => handleRunStarted(runId))
      .catch((err) => toast(errorMessage(err, 'Could not retry'), { variant: 'error' }))
  }

  // Live AI run wiring — a parallel of the enrichment subscription.
  useEffect(() => {
    if (!aiActiveRunId) return
    const api = getApi()
    const unsub = api.ai.subscribe({ tableId }, (e) => {
      if (e.type === 'cell') gridHandleRef.current?.applyAi(e.recordId, e.columnId, e.meta, e.value)
      if (e.type === 'run' && (e.run.status === 'complete' || e.run.status === 'failed' || e.run.status === 'paused')) {
        setRefreshToken((t) => t + 1)
        void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspace?.id] })
        void qc.invalidateQueries({ queryKey: ['ai', 'runs', workspace?.id] })
      }
    })
    return () => unsub()
  }, [aiActiveRunId, tableId, qc, workspace?.id])

  function handleAiRunStarted(runId: string) {
    setAiActiveRunId(runId)
    setRefreshToken((t) => t + 1)
  }

  function handleRetryAiCell(recordId: string, columnId: string) {
    setAiProvTarget(null)
    getApi()
      .ai.run(tableId, { mode: 'selected', recordIds: [recordId], columnIds: [columnId] }, { forceFresh: true })
      .then(({ runId }) => handleAiRunStarted(runId))
      .catch((err) => toast(errorMessage(err, 'Could not retry'), { variant: 'error' }))
  }

  // Live agent run wiring — a parallel of the AI subscription.
  useEffect(() => {
    if (!agentActiveRunId) return
    const api = getApi()
    const unsub = api.agent.subscribe({ tableId }, (e) => {
      if (e.type === 'cell') gridHandleRef.current?.applyAgent(e.recordId, e.columnId, e.meta, e.value)
      if (e.type === 'run' && (e.run.status === 'complete' || e.run.status === 'failed' || e.run.status === 'paused')) {
        setRefreshToken((t) => t + 1)
        void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspace?.id] })
      }
    })
    return () => unsub()
  }, [agentActiveRunId, tableId, qc, workspace?.id])

  function handleAgentRunStarted(runId: string) {
    setAgentActiveRunId(runId)
    setRefreshToken((t) => t + 1)
  }

  function handleRetryAgentCell(recordId: string, columnId: string) {
    setAgentProvTarget(null)
    getApi()
      .agent.run(tableId, { mode: 'selected', recordIds: [recordId], columnIds: [columnId] }, { forceFresh: true })
      .then(({ runId }) => handleAgentRunStarted(runId))
      .catch((err) => toast(errorMessage(err, 'Could not retry'), { variant: 'error' }))
  }

  // Live HTTP run wiring.
  useEffect(() => {
    if (!httpActiveRunId) return
    const api = getApi()
    const unsub = api.http.subscribe({ tableId }, (e) => {
      if (e.type === 'cell') gridHandleRef.current?.applyHttp(e.recordId, e.columnId, e.meta, e.value)
      if (e.type === 'run' && (e.run.status === 'complete' || e.run.status === 'failed' || e.run.status === 'paused')) {
        setRefreshToken((t) => t + 1)
        void qc.invalidateQueries({ queryKey: ['credits', 'balance', workspace?.id] })
      }
    })
    return () => unsub()
  }, [httpActiveRunId, tableId, qc, workspace?.id])

  function handleHttpRunStarted(runId: string) {
    setHttpActiveRunId(runId)
    setRefreshToken((t) => t + 1)
  }

  function handleRetryHttpCell(recordId: string, columnId: string) {
    setHttpProvTarget(null)
    getApi()
      .http.run(tableId, { mode: 'selected', recordIds: [recordId], columnIds: [columnId] }, { forceFresh: true })
      .then(({ runId }) => handleHttpRunStarted(runId))
      .catch((err) => toast(errorMessage(err, 'Could not retry'), { variant: 'error' }))
  }

  function requestSmartColumn(type: ColumnType, seedName: string) {
    if (type === 'ai') {
      setAiBuilderColumn(null)
      setAiSeedName(seedName)
      setAiBuilderOpen(true)
    } else if (type === 'agent') {
      setAgentBuilderColumn(null)
      setAgentSeedName(seedName)
      setAgentBuilderOpen(true)
    } else if (type === 'http') {
      setHttpBuilderColumn(null)
      setHttpSeedName(seedName)
      setHttpBuilderOpen(true)
    } else if (type === 'formula') {
      setFormulaBuilderColumn(null)
      setFormulaSeedName(seedName)
      setFormulaBuilderOpen(true)
    }
  }

  function onAiSaved() {
    void qc.invalidateQueries({ queryKey: ['ai', 'configs', tableId] })
    void qc.invalidateQueries({ queryKey: ['columns', tableId] })
    remountGrid()
  }

  function onAgentSaved() {
    void qc.invalidateQueries({ queryKey: ['agent', 'configs', tableId] })
    void qc.invalidateQueries({ queryKey: ['columns', tableId] })
    remountGrid()
  }
  function onHttpSaved() {
    void qc.invalidateQueries({ queryKey: ['http', 'configs', tableId] })
    void qc.invalidateQueries({ queryKey: ['columns', tableId] })
    remountGrid()
  }
  function onFormulaSaved() {
    void qc.invalidateQueries({ queryKey: ['formula', 'configs', tableId] })
    void qc.invalidateQueries({ queryKey: ['columns', tableId] })
    remountGrid()
  }

  function remountGrid() {
    setGridKey((k) => k + 1)
  }
  function onColumnsChanged() {
    remountGrid()
  }
  function onWaterfallSaved() {
    void qc.invalidateQueries({ queryKey: ['enrichment', 'configs', tableId] })
    remountGrid()
  }
  function onRowsDeleted() {
    void qc.invalidateQueries({ queryKey: ['rowCount', tableId] })
    remountGrid()
  }

  const deleteColumnMutation = useMutation({
    mutationFn: (columnId: string) => getApi().columns.remove(columnId),
    onSuccess: (_res, columnId) => {
      void qc.invalidateQueries({ queryKey: ['columns', tableId] })
      const name = deleteTarget?.id === columnId ? deleteTarget?.name : undefined
      toast(name ? `Deleted column “${name}”` : 'Column deleted', { variant: 'success' })
      setDeleteTarget(null)
      remountGrid()
    },
    onError: (err) => toast(errorMessage(err, 'Could not delete column'), { variant: 'error' }),
  })

  // Transitions out of the manage dialog wait a tick so the two Radix dialogs
  // never fight over the focus trap (mirrors the tables list page pattern).
  function requestAdd() {
    setManageOpen(false)
    setTimeout(() => setAddOpen(true), 0)
  }
  // Smart columns (ai/agent/http/formula) can't be edited through the plain
  // EditColumnDialog — their config lives in a dedicated builder. Re-open that
  // builder with the existing column loaded (edit mode); everything else goes to
  // the standard rename/retype dialog.
  function requestEdit(col: Column) {
    setManageOpen(false)
    setTimeout(() => {
      if (col.type === 'ai') {
        setAiBuilderColumn(col)
        setAiSeedName('')
        setAiBuilderOpen(true)
      } else if (col.type === 'agent') {
        setAgentBuilderColumn(col)
        setAgentSeedName('')
        setAgentBuilderOpen(true)
      } else if (col.type === 'http') {
        setHttpBuilderColumn(col)
        setHttpSeedName('')
        setHttpBuilderOpen(true)
      } else if (col.type === 'formula') {
        setFormulaBuilderColumn(col)
        setFormulaSeedName('')
        setFormulaBuilderOpen(true)
      } else {
        setEditTarget(col)
      }
    }, 0)
  }
  function requestDelete(col: Column) {
    setManageOpen(false)
    setTimeout(() => setDeleteTarget(col), 0)
  }

  // ---- Loading / error ----
  if (metaQuery.isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <div className={styles.spinner} role="status" aria-label="Loading table" />
        </div>
      </div>
    )
  }

  if (metaQuery.isError || !metaQuery.data) {
    const notFound = isApiError(metaQuery.error) && metaQuery.error.status === 404
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <div className={styles.errorBox}>
            <Alert variant="error" title={notFound ? 'Table not found' : 'Couldn’t load this table'}>
              {notFound
                ? 'It may have been deleted, or you may not have access to it.'
                : errorMessage(metaQuery.error)}
            </Alert>
            <Link href="/tables" className="btn btn-secondary">
              ← Back to tables
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const table = metaQuery.data
  const columnsEmpty = columnsQuery.isSuccess && columns.length === 0

  return (
    <div className={styles.page}>
      <GridToolbar
        tableName={table.name}
        rowCount={rowCountQuery.data}
        rowCountLoading={rowCountQuery.isLoading}
        tableId={tableId}
        columns={columns}
        views={views}
        activeViewId={activeViewId}
        onChangeView={setActiveViewId}
        writable={writable}
        hasEnrichment={enrichmentColumns.length > 0}
        hasAi={aiColumns.length > 0}
        hasAgent={agentColumns.length > 0}
        hasHttp={httpColumns.length > 0}
        onAddColumn={() => setAddOpen(true)}
        onManageColumns={() => setManageOpen(true)}
        onDeleteRows={() => setBulkOpen(true)}
        onEnrich={() => {
          setBuilderColumn(null)
          setBuilderOpen(true)
        }}
        onRun={() => setRunOpen(true)}
        onAddAiColumn={() => requestSmartColumn('ai', '')}
        onRunAi={() => setAiRunOpen(true)}
        onAddAgentColumn={() => requestSmartColumn('agent', '')}
        onRunAgent={() => setAgentRunOpen(true)}
        onAddHttpColumn={() => requestSmartColumn('http', '')}
        onRunHttp={() => setHttpRunOpen(true)}
        onAddFormulaColumn={() => requestSmartColumn('formula', '')}
        remountGrid={remountGrid}
      />

      {activeRunId && <RunProgress runId={activeRunId} onDone={() => setActiveRunId(null)} />}
      {aiActiveRunId && <RunProgress runId={aiActiveRunId} kind="ai" onDone={() => setAiActiveRunId(null)} />}
      {agentActiveRunId && <RunProgress runId={agentActiveRunId} kind="agent" onDone={() => setAgentActiveRunId(null)} />}
      {httpActiveRunId && <RunProgress runId={httpActiveRunId} kind="http" onDone={() => setHttpActiveRunId(null)} />}

      <div className={styles.gridHost}>
        {columnsEmpty ? (
          <EmptyState
            icon={<ColumnGlyph />}
            title="This table has no columns yet"
            description={
              writable
                ? 'Add your first column to start entering data.'
                : 'No columns have been added to this table yet.'
            }
            action={
              writable ? (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  Add column
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <TableGridDynamic
              key={gridKey}
              tableId={tableId}
              viewId={effectiveViewId}
              readOnly={!writable}
              enrichmentColumnIds={enrichmentColumnIds}
              aiColumnIds={aiColumnIds}
              agentColumnIds={agentColumnIds}
              httpColumnIds={httpColumnIds}
              formulaColumnIds={formulaColumnIds}
              refreshToken={refreshToken}
              onReady={(h) => {
                gridHandleRef.current = h
              }}
              onSelectionChange={(info) => setSelection({ recordIds: info.recordIds, count: info.recordIds.length })}
              onEnrichmentCellClick={(refCell, bounds) => setProvTarget({ recordId: refCell.recordId, columnId: refCell.columnId, rect: bounds })}
              onAiCellClick={(refCell, bounds) => setAiProvTarget({ recordId: refCell.recordId, columnId: refCell.columnId, rect: bounds })}
              onAgentCellClick={(refCell, bounds) => setAgentProvTarget({ recordId: refCell.recordId, columnId: refCell.columnId, rect: bounds })}
              onHttpCellClick={(refCell, bounds) => setHttpProvTarget({ recordId: refCell.recordId, columnId: refCell.columnId, rect: bounds })}
            />
            {workspace && (
              <ProvenancePopover
                target={provTarget}
                workspaceId={workspace.id}
                canCost={canCost}
                onClose={() => setProvTarget(null)}
                onRetry={handleRetryCell}
              />
            )}
            {workspace && (
              <AiProvenancePopover
                target={aiProvTarget}
                workspaceId={workspace.id}
                canCost={canCost}
                onClose={() => setAiProvTarget(null)}
                onRetry={handleRetryAiCell}
              />
            )}
            {workspace && (
              <AgentProvenancePopover
                target={agentProvTarget}
                workspaceId={workspace.id}
                canCost={canCost}
                onClose={() => setAgentProvTarget(null)}
                onRetry={handleRetryAgentCell}
              />
            )}
            {workspace && (
              <HttpProvenancePopover
                target={httpProvTarget}
                workspaceId={workspace.id}
                canCost={canCost}
                onClose={() => setHttpProvTarget(null)}
                onRetry={handleRetryHttpCell}
              />
            )}
          </>
        )}
      </div>

      {workspace && (
        <WaterfallBuilder
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          tableId={tableId}
          columns={columns}
          workspaceId={workspace.id}
          column={builderColumn}
          onSaved={onWaterfallSaved}
        />
      )}

      {enrichmentColumns.length > 0 && (
        <RunDialog
          open={runOpen}
          onOpenChange={setRunOpen}
          tableId={tableId}
          columns={enrichmentColumns}
          selection={selection}
          onStarted={handleRunStarted}
        />
      )}

      {workspace && (
        <AiColumnBuilder
          open={aiBuilderOpen}
          onOpenChange={setAiBuilderOpen}
          tableId={tableId}
          columns={columns}
          workspaceId={workspace.id}
          column={aiBuilderColumn}
          seedName={aiSeedName}
          onSaved={onAiSaved}
        />
      )}

      {aiColumns.length > 0 && (
        <RunDialog
          open={aiRunOpen}
          onOpenChange={setAiRunOpen}
          tableId={tableId}
          columns={aiColumns}
          selection={selection}
          onStarted={handleAiRunStarted}
          kind="ai"
        />
      )}

      {workspace && (
        <AgentColumnBuilder
          open={agentBuilderOpen}
          onOpenChange={setAgentBuilderOpen}
          tableId={tableId}
          columns={columns}
          workspaceId={workspace.id}
          column={agentBuilderColumn}
          seedName={agentSeedName}
          onSaved={onAgentSaved}
        />
      )}
      {agentColumns.length > 0 && (
        <RunDialog
          open={agentRunOpen}
          onOpenChange={setAgentRunOpen}
          tableId={tableId}
          columns={agentColumns}
          selection={selection}
          onStarted={handleAgentRunStarted}
          kind="agent"
        />
      )}

      {workspace && (
        <HttpColumnBuilder
          open={httpBuilderOpen}
          onOpenChange={setHttpBuilderOpen}
          tableId={tableId}
          columns={columns}
          workspaceId={workspace.id}
          column={httpBuilderColumn}
          seedName={httpSeedName}
          onSaved={onHttpSaved}
        />
      )}
      {httpColumns.length > 0 && (
        <RunDialog
          open={httpRunOpen}
          onOpenChange={setHttpRunOpen}
          tableId={tableId}
          columns={httpColumns}
          selection={selection}
          onStarted={handleHttpRunStarted}
          kind="http"
        />
      )}

      {workspace && (
        <FormulaColumnBuilder
          open={formulaBuilderOpen}
          onOpenChange={setFormulaBuilderOpen}
          tableId={tableId}
          columns={columns}
          workspaceId={workspace.id}
          column={formulaBuilderColumn}
          seedName={formulaSeedName}
          onSaved={onFormulaSaved}
        />
      )}

      <AddColumnDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tableId={tableId}
        onAdded={onColumnsChanged}
        onRequestSmartColumn={requestSmartColumn}
      />

      <ManageColumnsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        tableId={tableId}
        columns={columns}
        writable={writable}
        onRequestAdd={requestAdd}
        onRequestEdit={requestEdit}
        onRequestDelete={requestDelete}
        onChanged={onColumnsChanged}
      />

      <EditColumnDialog
        open={editTarget != null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        tableId={tableId}
        column={editTarget}
        onChanged={onColumnsChanged}
      />

      <BulkDeleteDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        tableId={tableId}
        viewId={effectiveViewId}
        columns={columns}
        total={rowCountQuery.data ?? 0}
        onDeleted={onRowsDeleted}
      />

      {/* Delete column confirm */}
      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="Delete column"
        description={
          deleteTarget
            ? `This permanently removes “${deleteTarget.name}” and every value in it. This can’t be undone.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => deleteTarget && deleteColumnMutation.mutate(deleteTarget.id)}
              disabled={deleteColumnMutation.isPending}
            >
              {deleteColumnMutation.isPending ? 'Deleting…' : 'Delete column'}
            </Button>
          </>
        }
      />
    </div>
  )
}
