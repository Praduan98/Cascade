// A real, fetch-backed implementation of the CascadeApi contract. It talks to
// the REST endpoints documented in ../CONTRACT.md 1:1, so the app can swap
// mock → real by config alone (see getApi()/setApi()) with no UI change.
//
// Design:
//  • One private request() does URL + query building, Bearer auth, JSON
//    (de)serialization, and maps non-2xx responses onto the errors.ts taxonomy
//    (including the new 401 → UnauthorizedError) so existing UI catch-blocks
//    keep working.
//  • The bearer token is held in memory and mirrored to localStorage (like the
//    mock), and restored on construction. The platform superadmin identity uses
//    a SEPARATE token, sent only to /platform/* calls.
//  • Per-cell status arrives over a single, per-workspace SSE connection opened
//    with a fetch() ReadableStream reader (so the Authorization header survives —
//    browser EventSource cannot set headers). StreamManager multiplexes the four
//    run namespaces + every {runId|tableId} target over that one socket, fans
//    events out client-side, and reconnects with Last-Event-ID so the server can
//    backfill status transitions missed while disconnected (see CONTRACT.md §4).

import type {
  AuditApi,
  AuthApi,
  BalanceInfo,
  BillingApi,
  BillingSummary,
  BudgetSettings,
  CascadeApi,
  CellsApi,
  ColumnsApi,
  ConsumptionBucket,
  CreditsApi,
  EnrichmentApi,
  EnrichmentEvent,
  EstimateResult,
  AgentApi,
  AgentEvent,
  AiApi,
  AiEvent,
  AutomationApi,
  FormulaApi,
  HttpApi as HttpColumnsApi,
  HttpEvent,
  InboundWebhookCreated,
  IntegrationApi,
  MembersApi,
  OnboardingApi,
  PatchCellsResult,
  PlatformAnalytics,
  PlatformApi,
  PlatformSession,
  PlatformWorkspaceSummary,
  RecordsApi,
  RunHandle,
  CacheStats,
  ListRecordsResult,
  SeatUsage,
  Session,
  TablesApi,
  TemplatesApi,
  ViewsApi,
  WorkspacesApi,
} from './api'
import type {
  AgentCellResult,
  AgentColumnConfig,
  AiCellResult,
  AiColumnConfig,
  AiModelInfo,
  AuditEntry,
  Automation,
  AutomationRun,
  Column,
  CreditLedgerEntry,
  CreditPurchase,
  CrmConnection,
  CrmSyncRun,
  EnrichmentCellResult,
  EnrichmentColumnConfig,
  EnrichmentRun,
  FormulaColumnConfig,
  HttpCellResult,
  HttpColumnConfig,
  HttpSecret,
  InboundWebhook,
  IntegrationEvent,
  Invite,
  Invoice,
  Member,
  OnboardingState,
  OutboundWebhook,
  Plan,
  Provider,
  ProviderCredential,
  RowWithCells,
  SequencerCampaign,
  SequencerConnection,
  SequencerPushRun,
  SlackConnection,
  Subscription,
  TableMeta,
  Template,
  View,
  Workspace,
} from '@cascade/core'
import type { PlatformAuditEntry } from '@cascade/core'
import {
  ApiError,
  BudgetError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors'

export interface HttpApiConfig {
  /** REST base including the version prefix, e.g. `${NEXT_PUBLIC_API_BASE_URL}/v1`. */
  baseUrl: string
  /** Seed the bearer token (otherwise restored from storage). */
  token?: string
  /** localStorage namespace for the persisted token(s). Default 'cascade'. */
  storageKey?: string
  /** Injectable fetch (tests / non-browser). Defaults to the global fetch. */
  fetch?: typeof fetch
}

// --- SSE transport ----------------------------------------------------------

type StreamKind = 'enrichment' | 'ai' | 'agent' | 'http'

/** The structural shape shared by every namespace event (see api.ts unions). */
interface AnyStreamEvent {
  type: 'cell' | 'run' | 'budget'
  runId?: string
  tableId?: string
  run?: { id?: string; tableId?: string }
}

interface StreamSubscriber {
  kind: StreamKind
  target: { runId?: string; tableId?: string }
  cb: (e: AnyStreamEvent) => void
}

interface StreamManagerOptions {
  /** Builds the per-workspace stream URL each (re)connect. */
  endpoint: () => string
  token: () => string | null
  fetchImpl: typeof fetch
}

/**
 * One multiplexed, per-workspace SSE connection shared by every subscriber.
 * Opens via fetch() + ReadableStream (keeps the Bearer header), fans events out
 * by kind + target, and reconnects with Last-Event-ID so the server can backfill
 * transitions missed while offline. The socket closes when the last subscriber
 * leaves.
 */
class StreamManager {
  private readonly subs = new Set<StreamSubscriber>()
  private controller: AbortController | null = null
  private running = false
  private lastEventId: string | null = null
  private attempts = 0

  constructor(private readonly o: StreamManagerOptions) {}

  add(sub: StreamSubscriber): () => void {
    this.subs.add(sub)
    this.start()
    return () => {
      this.subs.delete(sub)
      if (this.subs.size === 0) this.stop()
    }
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
    this.controller = null
  }

  private start(): void {
    if (this.running) return
    this.running = true
    void this.runLoop()
  }

  private async runLoop(): Promise<void> {
    while (this.running && this.subs.size > 0) {
      this.controller = new AbortController()
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        const token = this.o.token()
        if (token) headers.Authorization = `Bearer ${token}`
        if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId
        const res = await this.o.fetchImpl(this.o.endpoint(), { headers, signal: this.controller.signal })
        if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`)
        this.attempts = 0
        await this.consume(res.body)
        // A clean end means the server closed the tail; loop reconnects and the
        // Last-Event-ID header lets it backfill anything emitted in the gap.
      } catch {
        if (!this.running) break
      }
      if (!this.running || this.subs.size === 0) break
      await this.backoff()
    }
    this.running = false
    this.controller = null
  }

  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        this.handleFrame(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 2)
      }
    }
  }

  private handleFrame(frame: string): void {
    let id: string | null = null
    const data: string[] = []
    for (const raw of frame.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (!line || line.startsWith(':')) continue // heartbeat / comment
      const c = line.indexOf(':')
      const field = c === -1 ? line : line.slice(0, c)
      let val = c === -1 ? '' : line.slice(c + 1)
      if (val.startsWith(' ')) val = val.slice(1)
      if (field === 'id') id = val
      else if (field === 'data') data.push(val)
    }
    if (id) this.lastEventId = id
    if (data.length === 0) return
    let env: { kind?: StreamKind; event?: AnyStreamEvent }
    try {
      env = JSON.parse(data.join('\n'))
    } catch {
      return
    }
    if (!env?.kind || !env.event) return
    for (const sub of this.subs) {
      if (sub.kind !== env.kind) continue
      if (!matchesTarget(sub.target, env.event)) continue
      try {
        sub.cb(env.event)
      } catch {
        /* a subscriber callback threw; isolate it */
      }
    }
  }

  private backoff(): Promise<void> {
    const ms = Math.min(1000 * 2 ** Math.min(this.attempts++, 5), 15000)
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

function matchesTarget(target: { runId?: string; tableId?: string }, event: AnyStreamEvent): boolean {
  // Budget is workspace-wide → delivered to every subscriber of the kind.
  if (event.type === 'budget') return true
  if (target.runId) {
    const rid = event.type === 'run' ? event.run?.id : event.runId
    if (rid !== target.runId) return false
  }
  if (target.tableId) {
    const tid = event.type === 'run' ? event.run?.tableId : event.tableId
    if (tid !== target.tableId) return false
  }
  return true
}

// --- Error mapping ----------------------------------------------------------

async function toApiError(res: Response): Promise<ApiError> {
  let payload: { error?: Record<string, unknown> } | null = null
  try {
    payload = (await res.json()) as { error?: Record<string, unknown> }
  } catch {
    /* non-JSON error body */
  }
  const err = payload?.error ?? {}
  const msg = (err.message as string) || res.statusText || 'Request failed'
  switch (res.status) {
    case 401:
      return new UnauthorizedError(msg)
    case 402:
      return new BudgetError(msg, { maxCredits: err.maxCredits as number, cap: err.cap as number })
    case 403:
      return new ForbiddenError(msg)
    case 404:
      return new NotFoundError(msg)
    case 409:
      return new ConflictError(msg, err.currentValue)
    case 422:
      return new ValidationError(msg, err.fields as Record<string, string>)
    default:
      return new ApiError(msg, (err.code as string) || 'api_error', res.status)
  }
}

// --- HttpApi ----------------------------------------------------------------

export class HttpApi implements CascadeApi {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenKey: string
  private readonly ptokenKey: string
  private token: string | null
  private platformToken: string | null
  private currentWorkspaceId: string | null = null
  private readonly stream: StreamManager

  constructor(config: HttpApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis)
    const ns = config.storageKey ?? 'cascade'
    this.tokenKey = `${ns}:token`
    this.ptokenKey = `${ns}:ptoken`
    this.token = config.token ?? this.load(this.tokenKey)
    this.platformToken = this.load(this.ptokenKey)
    this.stream = new StreamManager({
      endpoint: () =>
        `${this.baseUrl}/stream${this.qs({
          workspaceId: this.currentWorkspaceId ?? undefined,
          kinds: 'enrichment,ai,agent,http',
        })}`,
      token: () => this.token,
      fetchImpl: this.fetchImpl,
    })
  }

  // --- request core ---------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown>; platform?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = this.baseUrl + path + this.qs(opts.query)
    const token = opts.platform ? this.platformToken : this.token
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers }
    if (token) headers.Authorization = `Bearer ${token}`
    const init: RequestInit = { method, headers }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      // An authenticated request that came back 401 means the token is dead.
      if (res.status === 401 && token) this.clearToken(opts.platform)
      throw await toApiError(res)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private get<T>(path: string, query?: Record<string, unknown>, platform = false): Promise<T> {
    return this.request<T>('GET', path, { query, platform })
  }
  private post<T>(path: string, body?: unknown, platform = false): Promise<T> {
    return this.request<T>('POST', path, { body, platform })
  }
  private patch<T>(path: string, body?: unknown, platform = false): Promise<T> {
    return this.request<T>('PATCH', path, { body, platform })
  }
  private put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body })
  }
  private del(path: string, platform = false): Promise<void> {
    return this.request<void>('DELETE', path, { platform })
  }

  private qs(query?: Record<string, unknown>): string {
    if (!query) return ''
    const parts: string[] = []
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    }
    return parts.length ? `?${parts.join('&')}` : ''
  }

  // --- session / token persistence -----------------------------------------

  private remember(s: Session): Session {
    this.token = s.token
    this.currentWorkspaceId = s.workspaceId
    this.persist(this.tokenKey, s.token)
    return s
  }
  private rememberPlatform(s: PlatformSession): PlatformSession {
    this.platformToken = s.token
    this.persist(this.ptokenKey, s.token)
    return s
  }
  private clearToken(platform?: boolean): void {
    if (platform) {
      this.platformToken = null
      this.persist(this.ptokenKey, null)
    } else {
      this.token = null
      this.currentWorkspaceId = null
      this.persist(this.tokenKey, null)
      this.stream.stop()
    }
  }
  private persist(key: string, value: string | null): void {
    try {
      if (typeof localStorage === 'undefined') return
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* storage unavailable (SSR / private mode) */
    }
  }
  private load(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    } catch {
      return null
    }
  }

  // =========================================================================
  // Namespaces
  // =========================================================================

  readonly auth: AuthApi = {
    signIn: (email, password) => this.post<Session>('/auth/sign-in', { email, password }).then((s) => this.remember(s)),
    signUp: (input) => this.post<Session>('/auth/sign-up', input).then((s) => this.remember(s)),
    magicLink: (email) => this.post<{ sent: true }>('/auth/magic-link', { email }),
    currentSession: async () => {
      try {
        const s = await this.get<Session | null>('/auth/session')
        return s ? this.remember(s) : null
      } catch (e) {
        if (e instanceof UnauthorizedError) return null
        throw e
      }
    },
    switchUser: (userId) => this.post<Session>('/auth/switch-user', { userId }).then((s) => this.remember(s)),
    signOut: async () => {
      try {
        await this.post<void>('/auth/sign-out')
      } finally {
        this.clearToken()
      }
    },
  }

  readonly workspaces: WorkspacesApi = {
    list: () => this.get<Workspace[]>('/workspaces'),
    get: (id) => this.get<Workspace>(`/workspaces/${id}`),
    create: (input) => this.post<Workspace>('/workspaces', input),
  }

  readonly members: MembersApi = {
    list: (ws) => this.get<Member[]>(`/workspaces/${ws}/members`),
    invite: (ws, input) => this.post<Invite>(`/workspaces/${ws}/invites`, input),
    updateRole: (ws, memberId, role) => this.patch<Member>(`/workspaces/${ws}/members/${memberId}`, { role }),
    remove: (ws, memberId) => this.del(`/workspaces/${ws}/members/${memberId}`),
    listPendingInvites: (ws) => this.get<Invite[]>(`/workspaces/${ws}/invites`, { status: 'pending' }),
    revokeInvite: (ws, inviteId) => this.del(`/workspaces/${ws}/invites/${inviteId}`),
  }

  readonly tables: TablesApi = {
    list: (ws) => this.get<TableMeta[]>(`/workspaces/${ws}/tables`),
    get: (tableId) => this.get<TableMeta>(`/tables/${tableId}`),
    create: (ws, input) => this.post<TableMeta>(`/workspaces/${ws}/tables`, input),
    rename: (tableId, name) => this.patch<TableMeta>(`/tables/${tableId}`, { name }),
    duplicate: (tableId, input) => this.post<TableMeta>(`/tables/${tableId}/duplicate`, input ?? {}),
    remove: (tableId) => this.del(`/tables/${tableId}`),
  }

  readonly columns: ColumnsApi = {
    list: (tableId) => this.get<Column[]>(`/tables/${tableId}/columns`),
    add: (tableId, input) => this.post<Column>(`/tables/${tableId}/columns`, input),
    update: (columnId, patch) => this.patch<Column>(`/columns/${columnId}`, patch),
    retype: (columnId, toType, config) =>
      this.post<{ column: Column; coerced: number; lost: number }>(`/columns/${columnId}/retype`, { toType, config }),
    reorder: (tableId, orderedColumnIds) =>
      this.post<Column[]>(`/tables/${tableId}/columns/reorder`, { orderedColumnIds }),
    remove: (columnId) => this.del(`/columns/${columnId}`),
  }

  readonly records: RecordsApi = {
    list: (tableId, opts) => {
      if (opts?.filters || opts?.sorts) {
        return this.post<ListRecordsResult>(`/tables/${tableId}/records/query`, {
          viewId: opts.viewId,
          filters: opts.filters,
          sorts: opts.sorts,
          offset: opts.offset,
          limit: opts.limit,
        })
      }
      return this.get<ListRecordsResult>(`/tables/${tableId}/records`, {
        viewId: opts?.viewId,
        offset: opts?.offset,
        limit: opts?.limit,
      })
    },
    count: (tableId, viewId) =>
      this.get<{ count: number }>(`/tables/${tableId}/records/count`, { viewId }).then((r) => r.count),
    add: (tableId, input) => this.post<RowWithCells>(`/tables/${tableId}/records`, input ?? {}),
    bulkDelete: (tableId, recordIds) =>
      this.post<{ deleted: number }>(`/tables/${tableId}/records/bulk-delete`, { recordIds }),
    reorder: (_tableId, recordId, toPosition) => this.post<void>(`/records/${recordId}/reorder`, { toPosition }),
  }

  readonly cells: CellsApi = {
    patch: (edits) => this.post<PatchCellsResult>('/cells/batch', { edits }),
  }

  readonly views: ViewsApi = {
    list: (tableId) => this.get<View[]>(`/tables/${tableId}/views`),
    create: (tableId, input) => this.post<View>(`/tables/${tableId}/views`, input),
    update: (viewId, patch) => this.patch<View>(`/views/${viewId}`, patch),
    remove: (viewId) => this.del(`/views/${viewId}`),
  }

  readonly audit: AuditApi = {
    list: (ws, opts) => this.get<AuditEntry[]>(`/workspaces/${ws}/audit`, { offset: opts?.offset, limit: opts?.limit }),
  }

  readonly enrichment: EnrichmentApi = {
    providers: {
      list: (ws) => this.get<Provider[]>(`/workspaces/${ws}/enrichment/providers`),
    },
    credentials: {
      list: (ws) => this.get<ProviderCredential[]>(`/workspaces/${ws}/enrichment/credentials`),
      upsert: (ws, input) => this.put<ProviderCredential>(`/workspaces/${ws}/enrichment/credentials`, input),
      remove: (ws, credentialId) => this.del(`/workspaces/${ws}/enrichment/credentials/${credentialId}`),
    },
    configs: {
      get: (columnId) => this.get<EnrichmentColumnConfig | null>(`/columns/${columnId}/enrichment-config`),
      list: (tableId) => this.get<EnrichmentColumnConfig[]>(`/tables/${tableId}/enrichment-configs`),
      upsert: ({ columnId, ...body }) => this.put<EnrichmentColumnConfig>(`/columns/${columnId}/enrichment-config`, body),
      remove: (columnId) => this.del(`/columns/${columnId}/enrichment-config`),
    },
    runs: {
      list: (ws, opts) =>
        this.get<EnrichmentRun[]>(`/workspaces/${ws}/runs`, {
          tableId: opts?.tableId,
          kind: 'enrichment',
          limit: opts?.limit,
          offset: opts?.offset,
        }),
      get: (runId) => this.get<EnrichmentRun>(`/runs/${runId}`),
    },
    estimate: (tableId, scope, opts) =>
      this.post<EstimateResult>(`/tables/${tableId}/enrichment/estimate`, { scope, forceFresh: opts?.forceFresh }),
    run: (tableId, scope, opts) =>
      this.post<RunHandle>(`/tables/${tableId}/enrichment/run`, {
        scope,
        forceFresh: opts?.forceFresh,
        confirmedMaxCredits: opts?.confirmedMaxCredits,
      }),
    results: (recordId, columnId) =>
      this.get<EnrichmentCellResult[]>(`/records/${recordId}/columns/${columnId}/enrichment-results`),
    cacheStats: (ws) => this.get<CacheStats>(`/workspaces/${ws}/enrichment/cache-stats`),
    subscribe: (target, cb) => this.stream.add({ kind: 'enrichment', target, cb: cb as StreamSubscriber['cb'] }),
  }

  readonly ai: AiApi = {
    models: {
      list: (ws) => this.get<AiModelInfo[]>(`/workspaces/${ws}/ai/models`),
    },
    configs: {
      get: (columnId) => this.get<AiColumnConfig | null>(`/columns/${columnId}/ai-config`),
      list: (tableId) => this.get<AiColumnConfig[]>(`/tables/${tableId}/ai-configs`),
      upsert: ({ columnId, ...body }) => this.put<AiColumnConfig>(`/columns/${columnId}/ai-config`, body),
      remove: (columnId) => this.del(`/columns/${columnId}/ai-config`),
    },
    runs: {
      list: (ws, opts) =>
        this.get<EnrichmentRun[]>(`/workspaces/${ws}/runs`, {
          tableId: opts?.tableId,
          kind: 'ai',
          limit: opts?.limit,
          offset: opts?.offset,
        }),
      get: (runId) => this.get<EnrichmentRun>(`/runs/${runId}`),
    },
    estimate: (tableId, scope, opts) =>
      this.post<EstimateResult>(`/tables/${tableId}/ai/estimate`, { scope, forceFresh: opts?.forceFresh }),
    run: (tableId, scope, opts) =>
      this.post<RunHandle>(`/tables/${tableId}/ai/run`, {
        scope,
        forceFresh: opts?.forceFresh,
        confirmedMaxCredits: opts?.confirmedMaxCredits,
      }),
    results: (recordId, columnId) => this.get<AiCellResult[]>(`/records/${recordId}/columns/${columnId}/ai-results`),
    cacheStats: (ws) => this.get<CacheStats>(`/workspaces/${ws}/ai/cache-stats`),
    subscribe: (target, cb) => this.stream.add({ kind: 'ai', target, cb: cb as StreamSubscriber['cb'] }),
  }

  readonly agent: AgentApi = {
    models: {
      list: (ws) => this.get<AiModelInfo[]>(`/workspaces/${ws}/ai/models`),
    },
    configs: {
      get: (columnId) => this.get<AgentColumnConfig | null>(`/columns/${columnId}/agent-config`),
      list: (tableId) => this.get<AgentColumnConfig[]>(`/tables/${tableId}/agent-configs`),
      upsert: ({ columnId, ...body }) => this.put<AgentColumnConfig>(`/columns/${columnId}/agent-config`, body),
      remove: (columnId) => this.del(`/columns/${columnId}/agent-config`),
    },
    runs: {
      list: (ws, opts) =>
        this.get<EnrichmentRun[]>(`/workspaces/${ws}/runs`, {
          tableId: opts?.tableId,
          kind: 'agent',
          limit: opts?.limit,
          offset: opts?.offset,
        }),
      get: (runId) => this.get<EnrichmentRun>(`/runs/${runId}`),
    },
    estimate: (tableId, scope, opts) =>
      this.post<EstimateResult>(`/tables/${tableId}/agent/estimate`, { scope, forceFresh: opts?.forceFresh }),
    run: (tableId, scope, opts) =>
      this.post<RunHandle>(`/tables/${tableId}/agent/run`, {
        scope,
        forceFresh: opts?.forceFresh,
        confirmedMaxCredits: opts?.confirmedMaxCredits,
      }),
    results: (recordId, columnId) =>
      this.get<AgentCellResult[]>(`/records/${recordId}/columns/${columnId}/agent-results`),
    cacheStats: (ws) => this.get<CacheStats>(`/workspaces/${ws}/agent/cache-stats`),
    subscribe: (target, cb) => this.stream.add({ kind: 'agent', target, cb: cb as StreamSubscriber['cb'] }),
  }

  readonly http: HttpColumnsApi = {
    secrets: {
      list: (ws) => this.get<HttpSecret[]>(`/workspaces/${ws}/http/secrets`),
      create: (ws, input) => this.post<HttpSecret>(`/workspaces/${ws}/http/secrets`, input),
      remove: (ws, secretId) => this.del(`/workspaces/${ws}/http/secrets/${secretId}`),
    },
    configs: {
      get: (columnId) => this.get<HttpColumnConfig | null>(`/columns/${columnId}/http-config`),
      list: (tableId) => this.get<HttpColumnConfig[]>(`/tables/${tableId}/http-configs`),
      upsert: ({ columnId, ...body }) => this.put<HttpColumnConfig>(`/columns/${columnId}/http-config`, body),
      remove: (columnId) => this.del(`/columns/${columnId}/http-config`),
    },
    runs: {
      list: (ws, opts) =>
        this.get<EnrichmentRun[]>(`/workspaces/${ws}/runs`, {
          tableId: opts?.tableId,
          kind: 'http',
          limit: opts?.limit,
          offset: opts?.offset,
        }),
      get: (runId) => this.get<EnrichmentRun>(`/runs/${runId}`),
    },
    estimate: (tableId, scope, opts) =>
      this.post<EstimateResult>(`/tables/${tableId}/http/estimate`, { scope, forceFresh: opts?.forceFresh }),
    run: (tableId, scope, opts) =>
      this.post<RunHandle>(`/tables/${tableId}/http/run`, {
        scope,
        forceFresh: opts?.forceFresh,
        confirmedMaxCredits: opts?.confirmedMaxCredits,
      }),
    results: (recordId, columnId) => this.get<HttpCellResult[]>(`/records/${recordId}/columns/${columnId}/http-results`),
    cacheStats: (ws) => this.get<CacheStats>(`/workspaces/${ws}/http/cache-stats`),
    subscribe: (target, cb) => this.stream.add({ kind: 'http', target, cb: cb as StreamSubscriber['cb'] }),
  }

  readonly formula: FormulaApi = {
    get: (columnId) => this.get<FormulaColumnConfig | null>(`/columns/${columnId}/formula-config`),
    list: (tableId) => this.get<FormulaColumnConfig[]>(`/tables/${tableId}/formula-configs`),
    upsert: ({ columnId, expression }) =>
      this.put<FormulaColumnConfig>(`/columns/${columnId}/formula-config`, { expression }),
    remove: (columnId) => this.del(`/columns/${columnId}/formula-config`),
    validate: (expression) => this.post<{ error: string | null }>('/formula/validate', { expression }),
    recomputeTable: (tableId) =>
      this.post<{ computed: number; errors: number }>(`/tables/${tableId}/formula/recompute`),
  }

  readonly automation: AutomationApi = {
    automations: {
      list: (ws) => this.get<Automation[]>(`/workspaces/${ws}/automations`),
      upsert: (ws, input) =>
        input.id
          ? this.patch<Automation>(`/workspaces/${ws}/automations/${input.id}`, input)
          : this.post<Automation>(`/workspaces/${ws}/automations`, input),
      setEnabled: (ws, id, enabled) => this.patch<Automation>(`/workspaces/${ws}/automations/${id}`, { isEnabled: enabled }),
      remove: (ws, id) => this.del(`/workspaces/${ws}/automations/${id}`),
      runNow: (ws, id) => this.post<AutomationRun>(`/workspaces/${ws}/automations/${id}/run`),
      runs: (ws, opts) =>
        this.get<AutomationRun[]>(`/workspaces/${ws}/automation-runs`, {
          automationId: opts?.automationId,
          limit: opts?.limit,
        }),
    },
    webhooks: {
      listInbound: (ws) => this.get<InboundWebhook[]>(`/workspaces/${ws}/webhooks/inbound`),
      createInbound: (ws, input) => this.post<InboundWebhookCreated>(`/workspaces/${ws}/webhooks/inbound`, input),
      setInboundEnabled: (ws, id, enabled) =>
        this.patch<InboundWebhook>(`/workspaces/${ws}/webhooks/inbound/${id}`, { isEnabled: enabled }),
      removeInbound: (ws, id) => this.del(`/workspaces/${ws}/webhooks/inbound/${id}`),
      simulateInbound: (slug, secret, payload) =>
        this.request<{ ok: boolean; recordId?: string; reason?: string }>('POST', `/hooks/in/${slug}`, {
          body: payload,
          headers: { 'X-Cascade-Webhook-Secret': secret },
        }),
      listOutbound: (ws) => this.get<OutboundWebhook[]>(`/workspaces/${ws}/webhooks/outbound`),
      createOutbound: (ws, input) => this.post<OutboundWebhook>(`/workspaces/${ws}/webhooks/outbound`, input),
      setOutboundEnabled: (ws, id, enabled) =>
        this.patch<OutboundWebhook>(`/workspaces/${ws}/webhooks/outbound/${id}`, { isEnabled: enabled }),
      removeOutbound: (ws, id) => this.del(`/workspaces/${ws}/webhooks/outbound/${id}`),
    },
  }

  readonly integration: IntegrationApi = {
    crm: {
      list: (ws) => this.get<CrmConnection[]>(`/workspaces/${ws}/integrations/crm`),
      connect: (ws, input) => this.post<CrmConnection>(`/workspaces/${ws}/integrations/crm`, input),
      updateMapping: (ws, id, patch) => this.patch<CrmConnection>(`/workspaces/${ws}/integrations/crm/${id}`, patch),
      disconnect: (ws, id) => this.del(`/workspaces/${ws}/integrations/crm/${id}`),
      sync: (ws, id, direction) => this.post<CrmSyncRun>(`/workspaces/${ws}/integrations/crm/${id}/sync`, { direction }),
      syncRuns: (ws, opts) =>
        this.get<CrmSyncRun[]>(`/workspaces/${ws}/integrations/crm/sync-runs`, {
          connectionId: opts?.connectionId,
          limit: opts?.limit,
        }),
    },
    slack: {
      get: (ws) => this.get<SlackConnection | null>(`/workspaces/${ws}/integrations/slack`),
      connect: (ws, input) => this.post<SlackConnection>(`/workspaces/${ws}/integrations/slack`, input),
      disconnect: (ws) => this.del(`/workspaces/${ws}/integrations/slack`),
      notify: (ws, input) => this.post<{ ok: boolean }>(`/workspaces/${ws}/integrations/slack/notify`, input),
    },
    sequencers: {
      list: (ws) => this.get<SequencerConnection[]>(`/workspaces/${ws}/integrations/sequencers`),
      connect: (ws, input) => this.post<SequencerConnection>(`/workspaces/${ws}/integrations/sequencers`, input),
      disconnect: (ws, id) => this.del(`/workspaces/${ws}/integrations/sequencers/${id}`),
      campaigns: (ws, id) => this.get<SequencerCampaign[]>(`/workspaces/${ws}/integrations/sequencers/${id}/campaigns`),
      push: (ws, id, input) => this.post<SequencerPushRun>(`/workspaces/${ws}/integrations/sequencers/${id}/push`, input),
      pushRuns: (ws, opts) =>
        this.get<SequencerPushRun[]>(`/workspaces/${ws}/integrations/sequencers/push-runs`, {
          connectionId: opts?.connectionId,
          limit: opts?.limit,
        }),
    },
    events: (ws, opts) =>
      this.get<IntegrationEvent[]>(`/workspaces/${ws}/integrations/events`, {
        source: opts?.source,
        limit: opts?.limit,
        offset: opts?.offset,
      }),
  }

  readonly templates: TemplatesApi = {
    list: () => this.get<Template[]>('/templates'),
    get: (templateId) => this.get<Template | null>(`/templates/${templateId}`),
    instantiate: (ws, templateId, opts) =>
      this.post<TableMeta>(`/workspaces/${ws}/templates/${templateId}/instantiate`, { tableName: opts?.tableName }),
  }

  readonly onboarding: OnboardingApi = {
    get: (ws) => this.get<OnboardingState>(`/workspaces/${ws}/onboarding`),
    complete: (ws, opts) => this.post<OnboardingState>(`/workspaces/${ws}/onboarding/complete`, { tableId: opts?.tableId }),
    skip: (ws) => this.post<OnboardingState>(`/workspaces/${ws}/onboarding/skip`),
    reset: (ws) => this.post<OnboardingState>(`/workspaces/${ws}/onboarding/reset`),
  }

  readonly credits: CreditsApi = {
    balance: (ws) => this.get<BalanceInfo>(`/workspaces/${ws}/credits/balance`),
    budget: {
      get: (ws) => this.get<BudgetSettings>(`/workspaces/${ws}/credits/budget`),
      set: (ws, patch) => this.patch<BudgetSettings>(`/workspaces/${ws}/credits/budget`, patch),
    },
    ledger: (ws, opts) =>
      this.get<CreditLedgerEntry[]>(`/workspaces/${ws}/credits/ledger`, {
        runId: opts?.runId,
        limit: opts?.limit,
        offset: opts?.offset,
      }),
    consumptionByProvider: (ws, opts) =>
      this.get<ConsumptionBucket[]>(`/workspaces/${ws}/credits/consumption`, { groupBy: 'provider', since: opts?.since }),
    consumptionByColumn: (ws, opts) =>
      this.get<ConsumptionBucket[]>(`/workspaces/${ws}/credits/consumption`, { groupBy: 'column', since: opts?.since }),
    consumptionByTable: (ws, opts) =>
      this.get<ConsumptionBucket[]>(`/workspaces/${ws}/credits/consumption`, { groupBy: 'table', since: opts?.since }),
    consumptionByModel: (ws, opts) =>
      this.get<ConsumptionBucket[]>(`/workspaces/${ws}/credits/consumption`, { groupBy: 'model', since: opts?.since }),
  }

  readonly billing: BillingApi = {
    plans: {
      list: () => this.get<Plan[]>('/plans'),
    },
    summary: (ws) => this.get<BillingSummary>(`/workspaces/${ws}/billing/summary`),
    changePlan: (ws, planId) => this.post<Subscription>(`/workspaces/${ws}/billing/change-plan`, { planId }),
    setCancel: (ws, cancelAtPeriodEnd) => this.post<Subscription>(`/workspaces/${ws}/billing/cancel`, { cancelAtPeriodEnd }),
    purchaseCredits: (ws, input) => this.post<CreditPurchase>(`/workspaces/${ws}/billing/purchase-credits`, input),
    purchases: (ws) => this.get<CreditPurchase[]>(`/workspaces/${ws}/billing/purchases`),
    invoices: (ws) => this.get<Invoice[]>(`/workspaces/${ws}/billing/invoices`),
    seatUsage: (ws) => this.get<SeatUsage>(`/workspaces/${ws}/billing/seats`),
  }

  readonly platform: PlatformApi = {
    auth: {
      signIn: (email, password) =>
        this.post<PlatformSession>('/platform/auth/sign-in', { email, password }, true).then((s) => this.rememberPlatform(s)),
      currentSession: async () => {
        try {
          const s = await this.get<PlatformSession | null>('/platform/auth/session', undefined, true)
          return s ? this.rememberPlatform(s) : null
        } catch (e) {
          if (e instanceof UnauthorizedError) return null
          throw e
        }
      },
      signOut: async () => {
        try {
          await this.post<void>('/platform/auth/sign-out', undefined, true)
        } finally {
          this.clearToken(true)
        }
      },
    },
    workspaces: {
      list: () => this.get<PlatformWorkspaceSummary[]>('/platform/workspaces', undefined, true),
      get: (ws) => this.get<PlatformWorkspaceSummary>(`/platform/workspaces/${ws}`, undefined, true),
      members: (ws) => this.get<Member[]>(`/platform/workspaces/${ws}/members`, undefined, true),
      setSuspended: (ws, suspended, reason) =>
        this.post<Workspace>(`/platform/workspaces/${ws}/suspension`, { suspended, reason }, true),
      deactivateUser: (ws, userId, reason) =>
        this.post<void>(`/platform/workspaces/${ws}/members/${userId}/deactivate`, { reason }, true),
      compCredits: (ws, credits, reason) =>
        this.post<void>(`/platform/workspaces/${ws}/comp-credits`, { credits, reason }, true),
      overridePlan: (ws, planId, reason) =>
        this.post<Subscription>(`/platform/workspaces/${ws}/override-plan`, { planId, reason }, true),
    },
    invoices: {
      list: (ws) => this.get<Invoice[]>(`/platform/workspaces/${ws}/invoices`, undefined, true),
      refund: (invoiceId, reason) => this.post<Invoice>(`/platform/invoices/${invoiceId}/refund`, { reason }, true),
    },
    analytics: (opts) => this.get<PlatformAnalytics>('/platform/analytics', { since: opts?.since }, true),
    audit: (opts) => this.get<PlatformAuditEntry[]>('/platform/audit', { limit: opts?.limit, offset: opts?.offset }, true),
  }
}
