# Cascade REST Contract

**Status:** proposal for the backend team to implement against.
**Source of truth:** the `CascadeApi` interface in [`src/api.ts`](./src/api.ts) and the shared types in `@cascade/core` (`packages/core/src/types.ts`). This document maps **every** `CascadeApi` method to a concrete HTTP endpoint. It changes neither the interface nor the shared types — a forthcoming `HttpApi implements CascadeApi` will call these endpoints so the app swaps mock → real by config only.

Response bodies are named by their `@cascade/core` / `api.ts` TypeScript type (the canonical shape). Only wire **envelopes** that don't already exist as a type are expanded inline. JSON is the only content type. `HttpApi` is responsible for (de)serializing to/from the exact TS shapes.

---

## 1. Conventions

| Aspect | Rule |
| --- | --- |
| **Base URL** | `${NEXT_PUBLIC_API_BASE_URL}/v1` (e.g. `http://localhost:8000/v1`). Configured on `HttpApi`; no hard-coded hosts. |
| **Versioning** | Path-prefixed `/v1`. Breaking changes → `/v2`. |
| **Content type** | `application/json; charset=utf-8` for all request and response bodies. |
| **IDs** | Opaque strings (the mock uses `tbl_…`, `col_…`, `rec_…`, etc.). Never assume a format. |
| **Timestamps** | ISO-8601 UTC strings (`2026-07-11T12:00:00.000Z`). |
| **Pagination** | `?offset=<int>&limit=<int>` query params where the method exposes them. Servers should cap `limit`. |
| **Empty success** | `void`-returning methods → **`204 No Content`** (no body). |
| **`null` returns** | Methods typed `Promise<T \| null>` → **`200`** with body `null` when absent (not `404`). |
| **Scoping** | Every resource is workspace-scoped; there is **no unscoped read path** except `GET /templates`, `GET /plans`, and the entire `/platform/*` tree (separate superadmin identity). |
| **Redaction** | `providerCostUsd` / `maxProviderCostUsd` → `null`, and `AiModelInfo.providerCostUsd` → `0`, for non-admin viewers (US-2.12). Enforced server-side by role. |
| **Write-only secrets** | `apiKey` / `token` fields are accepted on write and **never** returned in any response (masked hint only, FR-3.5). |

### Two path families for scoping

1. **Workspace-scoped collections** live under `/v1/workspaces/{workspaceId}/…`. The `{workspaceId}` must resolve to a workspace the bearer token is an active member of, else `403`/`404`.
2. **Entity-addressed resources** are reached by their own id — `/v1/tables/{tableId}`, `/columns/{columnId}`, `/records/{recordId}`, `/views/{viewId}`, `/runs/{runId}`, `/invoices/{invoiceId}`. The server resolves the tenant **from the entity** and authorizes via the token's memberships. Cross-tenant access returns **`404`** (never leak existence).

Sub-collections hang off their parent entity: `/tables/{tableId}/columns`, `/tables/{tableId}/records`, `/columns/{columnId}/enrichment-config`, etc.

---

## 2. Auth scheme (recommendation)

**Recommendation: opaque Bearer token, server-side session.** This matches the mock, which already issues `Session.token` with `expiresAt`, and needs no crypto on the client.

- Every request except the sign-in family and public webhook ingest carries `Authorization: Bearer <token>`, where `<token>` is `Session.token`.
- The client persists the token (localStorage, mirroring the mock's persistence) and reattaches it on load via `GET /v1/auth/session`.
- **Workspace authorization** is derived server-side from the token's memberships. A `workspaceId` in the path that the actor can't access → `403` (member of no such workspace) or `404` (entity out of tenant).
- **Platform superadmin** (`/v1/platform/*`) uses a **separate** `PlatformSession.token`, also `Authorization: Bearer`, but a distinct identity that is never a workspace role (FR-4.2). `HttpApi` stores it separately and sends it **only** to `/platform/*`.
- **Expiry:** a `401 { code: "token_expired" }` tells the client to clear the session and route to sign-in. (No refresh-token rotation in this phase; this is where it would slot in.)

Endpoints that do **not** require a bearer token: `POST /auth/sign-in`, `POST /auth/sign-up`, `POST /auth/magic-link`, `POST /platform/auth/sign-in`, and the public webhook ingest `POST /hooks/in/{slug}` (authenticated by the webhook secret instead).

---

## 3. Error envelope

Non-2xx responses carry:

```json
{ "error": { "code": "string", "message": "string",
             "fields": { "email": "…" },   // 422 only, optional
             "currentValue": <any>,        // 409 only
             "maxCredits": 120, "cap": 100 // 402 only
} }
```

`HttpApi` reads **HTTP status + `error.code`** and throws the matching class from [`src/errors.ts`](./src/errors.ts), so existing UI `catch` blocks survive the swap unchanged:

| Status | `code` | Error class | Extra fields |
| --- | --- | --- | --- |
| 402 | `budget` | `BudgetError` | `maxCredits`, `cap` |
| 403 | `forbidden` | `ForbiddenError` | — |
| 404 | `not_found` | `NotFoundError` | — |
| 409 | `conflict` | `ConflictError` | `currentValue` |
| 422 | `validation` | `ValidationError` | `fields` |
| 401 | `unauthorized` / `token_expired` | `UnauthorizedError` | — |
| 5xx / other | `api_error` | `ApiError` (generic) | — |

> **Batch note:** `POST /cells/batch` returns **`200`** even when some edits are stale — per-cell conflicts are reported in the response body's `conflicts[]`, **not** as a `409`. The `409 ConflictError` is reserved for single-entity writes.

---

## 4. Status transport (recommendation: SSE)

Per-cell status (`Queued → Running → Success/Empty/Failed/Cached`) is produced by **server-side** run execution. The client only ever *receives* these; it never sends anything back over the channel (runs are started with a plain `POST …/run`). That one-directional shape is exactly what **Server-Sent Events** is for.

### Recommendation & rationale

| Option | Verdict |
| --- | --- |
| **SSE** ✅ **recommended** | One-way server→client fits the model; built-in resume via `Last-Event-ID`; rides plain HTTP/2 (multiplexed, no extra infra); trivially proxied. |
| WebSocket | Rejected — bidirectional duplex we don't need; adds upgrade handling, ping/pong, sticky-session/load-balancer concerns for zero benefit here. |
| Polling | Kept as the **degraded fallback** (below), not the primary. |

### Endpoint — one multiplexed, per-workspace stream

```
GET /v1/stream?workspaceId={ws}&kinds=enrichment,ai,agent,http
Authorization: Bearer <token>
Accept: text/event-stream
Last-Event-ID: <last cursor>   # only on reconnect
```

- **Connection scope is per-workspace.** `HttpApi` opens **one** connection for the acting workspace (the `workspaceId` from the current `Session`). All four namespace `subscribe()` methods and every `{runId|tableId}` target multiplex over that single connection; the client fans events out to the matching callbacks and returns each caller its own unsubscribe (closing the socket only when the last subscriber leaves). Narrower single-subscriber streams may still pass `tableId`/`runId` query filters, but the shared client stream is workspace-scoped and filters client-side.
- **Auth over SSE:** browser `EventSource` **cannot set headers**. `HttpApi` therefore opens the stream with a **`fetch()` + `ReadableStream` reader** (which *does* allow `Authorization: Bearer`) and parses the `text/event-stream` frames itself. This keeps the same bearer scheme as every other call — no token-in-URL.
- **Fallback (documented, not primary):** if a raw `EventSource` is ever required (no `fetch`-stream support), mint a short-lived one-time ticket via `POST /v1/stream/ticket` (bearer-authed) → `{ ticket, expiresAt }`, then `GET /v1/stream?ticket=…&workspaceId={ws}`. The ticket is single-use and short-lived so the long-lived token never lands in a URL or proxy log.

### Event frame

Each SSE message carries an `id:` (monotonic cursor) and a `data:` JSON envelope:

```
id: 000000123
event: cascade
data: { "kind": "enrichment", "event": { "type": "cell", "runId": "run_…", "tableId": "tbl_…",
        "recordId": "rec_…", "columnId": "col_…", "meta": { …EnrichmentCellMeta }, "value": <CellValue?> } }
```

**Envelope guarantees (required for correct client fan-out):** every frame's `event` MUST carry, at minimum:
- **operation type** — the top-level `kind` (`enrichment | ai | agent | http`), so one connection routes to the correct namespace subscriber.
- **runId** — on `cell` and (via `run.id`) `run` events, so a `subscribe({ runId })` caller receives only its run's transitions.
- **cell id** — the `(recordId, columnId)` pair on `cell` events, so the client patches the exact grid cell.
- **tableId** — on `cell`/`run` events, so a `subscribe({ tableId })` caller is matched.

`event` is **exactly** the existing union for that `kind` — `EnrichmentEvent | AiEvent | AgentEvent | HttpEvent` from `api.ts` (`{type:'cell',…}` / `{type:'run', run}` / `{type:'budget', workspaceId, balance, paused}`). The only per-kind difference is the `cell` event's `meta` type. `HttpApi` routes on `kind` + `type` and delivers to the right typed callback. **Heartbeat:** a `:` comment line every ~15 s keeps intermediaries from timing the connection out.

### Reconnect, resume & missed-event backfill — **BACKEND REQUIREMENT**

A run executes server-side over seconds-to-minutes. If the `/stream` connection drops mid-run (network blip, proxy idle-timeout, tab sleep) and the client silently misses the terminal `cell` events, affected cells would be **stuck on "Running" forever**. Preventing that is a hard requirement on the stream server, not a client nicety:

1. The server assigns every emitted event a **monotonic `id:`** (the resume cursor), unique and ordered within a workspace stream.
2. `HttpApi` records the last id it saw and, on every reconnect, sends it back as **`Last-Event-ID: <cursor>`**.
3. On receiving `Last-Event-ID`, the server **MUST backfill** — replay every event after that cursor for the workspace's still-active runs (at least the missed `cell`/`run`/`budget` transitions) **before** resuming the live tail. This drives every mid-flight cell to its correct terminal status even though the client was disconnected when it happened.
4. Backfill must survive a brief server-side buffer window (long enough to cover realistic reconnects for the longest run); events for runs already terminal at reconnect may be coalesced to their final state.

Belt-and-suspenders on the client (in addition to, not instead of, the above): after a reconnect it MAY re-`GET /runs/{runId}` + the affected `…-results` to reconcile, but correctness must not depend on it — the `Last-Event-ID` backfill is the contract.

### Polling fallback (degraded)

If streaming is unavailable, poll while a run is active (~1.5–2 s, backing off when idle):

- `GET /v1/runs/{runId}` → run status + counts (drives run/budget UI).
- `GET /v1/tables/{tableId}/cell-status?runId={runId}&since={cursor}` → **proposed** lightweight delta endpoint returning cells changed since `cursor`: `{ cursor, cells: [{ recordId, columnId, kind, meta, value? }] }`. (Absent this, fall back to re-reading `…-results` per touched cell.)

---

## 5. Endpoints by namespace

Legend: **WS** = `{workspaceId}` path segment under `/v1/workspaces/…`. Bodies/queries list only the fields the method supplies. All non-listed error rows may also return `401` (unauthenticated) and `5xx`.

### 5.1 `auth` — `AuthApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `signIn(email, password?)` | POST | `/auth/sign-in` | `{ email, password? }` | `200 Session` | 401 unauthorized, 422 |
| `signUp(input)` | POST | `/auth/sign-up` | `{ email, password?, name?, workspaceName?, planId? }` | `200 Session` | 409 (email taken), 422 |
| `magicLink(email)` | POST | `/auth/magic-link` | `{ email }` | `200 { "sent": true }` | 422 |
| `currentSession()` | GET | `/auth/session` | — | `200 Session \| null` | — |
| `switchUser(userId)` | POST | `/auth/switch-user` | `{ userId }` | `200 Session` | 403, 404 |
| `signOut()` | POST | `/auth/sign-out` | — | `204` | — |

> `switchUser` is a demo/dev affordance (role exploration). Gate it to non-production or behind a flag on the real backend.

### 5.2 `workspaces` — `WorkspacesApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list()` | GET | `/workspaces` | — | `200 Workspace[]` | — |
| `get(id)` | GET | `/workspaces/{id}` | — | `200 Workspace` | 403, 404 |
| `create({name})` | POST | `/workspaces` | `{ name }` | `201 Workspace` | 422 |

### 5.3 `members` — `MembersApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/workspaces/WS/members` | — | `200 Member[]` | 403, 404 |
| `invite(ws, {email, role})` | POST | `/workspaces/WS/invites` | `{ email, role }` | `201 Invite` | 403, 409, 422 |
| `updateRole(ws, memberId, role)` | PATCH | `/workspaces/WS/members/{memberId}` | `{ role }` | `200 Member` | 403, 404, 422 |
| `remove(ws, memberId)` | DELETE | `/workspaces/WS/members/{memberId}` | — | `204` | 403, 404 |
| `listPendingInvites(ws)` | GET | `/workspaces/WS/invites?status=pending` | — | `200 Invite[]` | 403 |
| `revokeInvite(ws, inviteId)` | DELETE | `/workspaces/WS/invites/{inviteId}` | — | `204` | 403, 404 |

### 5.4 `tables` — `TablesApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/workspaces/WS/tables` | — | `200 TableMeta[]` | 403 |
| `get(tableId)` | GET | `/tables/{tableId}` | — | `200 TableMeta` | 404 |
| `create(ws, {name})` | POST | `/workspaces/WS/tables` | `{ name }` | `201 TableMeta` | 403, 422 |
| `rename(tableId, name)` | PATCH | `/tables/{tableId}` | `{ name }` | `200 TableMeta` | 403, 404, 422 |
| `duplicate(tableId, opts?)` | POST | `/tables/{tableId}/duplicate` | `{ name?, includeRecords? }` | `201 TableMeta` | 403, 404 |
| `remove(tableId)` | DELETE | `/tables/{tableId}` | — | `204` | 403, 404 |

### 5.5 `columns` — `ColumnsApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(tableId)` | GET | `/tables/{tableId}/columns` | — | `200 Column[]` | 404 |
| `add(tableId, input)` | POST | `/tables/{tableId}/columns` | `AddColumnInput` `{ name, type, config?, position?, isFrozen?, width? }` | `201 Column` | 403, 404, 422 |
| `update(columnId, patch)` | PATCH | `/columns/{columnId}` | `UpdateColumnInput` `{ name?, config?, isFrozen?, width? }` | `200 Column` | 403, 404, 422 |
| `retype(columnId, toType, config?)` | POST | `/columns/{columnId}/retype` | `{ toType, config? }` | `200 { column: Column, coerced: number, lost: number }` | 403, 404, 422 |
| `reorder(tableId, orderedColumnIds)` | POST | `/tables/{tableId}/columns/reorder` | `{ orderedColumnIds: string[] }` | `200 Column[]` | 403, 404, 422 |
| `remove(columnId)` | DELETE | `/columns/{columnId}` | — | `204` | 403, 404 |

### 5.6 `records` — `RecordsApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(tableId, opts?)` — simple | GET | `/tables/{tableId}/records?viewId=&offset=&limit=` | — | `200 { rows: RowWithCells[], total: number }` | 404 |
| `list(tableId, opts?)` — ad-hoc filter/sort | POST | `/tables/{tableId}/records/query` | `{ viewId?, filters?: FilterGroup, sorts?: SortSpec[], offset?, limit? }` | `200 { rows, total }` | 404, 422 |
| `count(tableId, viewId?)` | GET | `/tables/{tableId}/records/count?viewId=` | — | `200 { count: number }` | 404 |
| `add(tableId, input?)` | POST | `/tables/{tableId}/records` | `AddRecordInput` `{ position?, cells?: Record<colId, CellValue> }` | `201 RowWithCells` | 403, 404, 422 |
| `bulkDelete(tableId, recordIds)` | POST | `/tables/{tableId}/records/bulk-delete` | `{ recordIds: string[] }` | `200 { deleted: number }` | 403, 404 |
| `reorder(tableId, recordId, toPosition)` | POST | `/records/{recordId}/reorder` | `{ toPosition: number }` | `204` | 403, 404, 422 |

> `list` has two forms: use GET for viewId/pagination only; use POST `…/records/query` whenever `filters`/`sorts` are supplied (complex objects don't belong in a query string). `HttpApi` picks based on `opts`.

### 5.7 `cells` — `CellsApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `patch(edits)` | POST | `/cells/batch` | `{ edits: CellEdit[] }` where `CellEdit = { recordId, columnId, value, expectedUpdatedAt? }` | `200 { updated: CellUpdate[], conflicts: CellConflict[] }` | 403, 404, 422 |

Stale edits are reported per-cell in `conflicts[]` (see §3 batch note), not as a top-level `409`.

### 5.8 `views` — `ViewsApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(tableId)` | GET | `/tables/{tableId}/views` | — | `200 View[]` | 404 |
| `create(tableId, input)` | POST | `/tables/{tableId}/views` | `CreateViewInput` `{ name, filters?, sorts?, columnState? }` | `201 View` | 403, 404, 422 |
| `update(viewId, patch)` | PATCH | `/views/{viewId}` | `UpdateViewInput` `{ name?, filters?, sorts?, columnState? }` | `200 View` | 403, 404, 422 |
| `remove(viewId)` | DELETE | `/views/{viewId}` | — | `204` | 403, 404 |

### 5.9 `audit` — `AuditApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(ws, {offset?, limit?})` | GET | `/workspaces/WS/audit?offset=&limit=` | — | `200 AuditEntry[]` | 403 |

### 5.10 Run namespaces — `enrichment`, `ai`, `agent`, `http`

These four share an identical shape (`estimate` / `run` / `results` / `cacheStats` / `runs` / `subscribe`) and differ only in the config sub-resource and the per-cell `meta`/`result` type. `{kind}` ∈ `enrichment | ai | agent | http`. All runs are unified `EnrichmentRun` records.

**Common per-kind operations:**

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `estimate(tableId, scope, {forceFresh?})` | POST | `/tables/{tableId}/{kind}/estimate` | `{ scope: RunScope, forceFresh? }` | `200 EstimateResult` | 403, 404, 422 |
| `run(tableId, scope, opts?)` | POST | `/tables/{tableId}/{kind}/run` | `{ scope: RunScope, forceFresh?, confirmedMaxCredits? }` | `202 { runId }` (`RunHandle`) | 402 budget, 403, 404, 422 |
| `results(recordId, columnId)` | GET | `/records/{recordId}/columns/{columnId}/{kind}-results` | — | `200 <Kind>CellResult[]` (newest-first) | 404 |
| `cacheStats(ws)` | GET | `/workspaces/WS/{kind}/cache-stats` | — | `200 CacheStats` | 403 |
| `subscribe(target, cb)` | — | SSE `/stream` (see §4), `kinds={kind}` | — | event stream | — |

`RunScope = { mode: 'selected'|'whole'|'empty-only', recordIds?, columnIds }`.

**Shared runs sub-resource** (`RunsApi`, reused by all four `.runs`):

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `runs.list(ws, {tableId?, limit?, offset?})` | GET | `/workspaces/WS/runs?tableId=&kind=&limit=&offset=` | — | `200 EnrichmentRun[]` |
| `runs.get(runId)` | GET | `/runs/{runId}` | — | `200 EnrichmentRun` |

**Config sub-resources** (differ per kind):

| Namespace | get / list / upsert / remove | Upsert body |
| --- | --- | --- |
| `enrichment.configs` | `GET /columns/{col}/enrichment-config` (→ `EnrichmentColumnConfig \| null`) · `GET /tables/{tbl}/enrichment-configs` · `PUT /columns/{col}/enrichment-config` · `DELETE /columns/{col}/enrichment-config` | `UpsertConfigInput` `{ autoRun?, forceFreshDefault?, steps: EnrichmentStep[] }` |
| `ai.configs` | `…/ai-config` · `/tables/{tbl}/ai-configs` (→ `AiColumnConfig`) | `UpsertAiConfigInput` `{ model, operation, promptTemplate, outputSchema?, outputMapping?, cacheTtlDays?, autoRun?, forceFreshDefault? }` |
| `agent.configs` | `…/agent-config` · `/tables/{tbl}/agent-configs` (→ `AgentColumnConfig`) | `UpsertAgentConfigInput` `{ model, objective, outputSchema?, outputMapping?, maxSteps?, maxPages?, cacheTtlDays?, autoRun?, forceFreshDefault? }` |
| `http.configs` | `…/http-config` · `/tables/{tbl}/http-configs` (→ `HttpColumnConfig`) | `UpsertHttpConfigInput` `{ method, urlTemplate, headers?, bodyTemplate?, responsePath, responseMapping?, outputMapping?, cacheTtlDays?, autoRun?, forceFreshDefault? }` |

`columnId` in the upsert body is redundant with the path and may be omitted on the wire.

**Per-kind extras:**

- `enrichment.providers.list(ws)` → `GET /workspaces/WS/enrichment/providers` → `200 Provider[]`.
- `enrichment.credentials` — `GET /workspaces/WS/enrichment/credentials` (→ `ProviderCredential[]`) · `PUT /workspaces/WS/enrichment/credentials` body `UpsertCredentialInput` `{ providerId, apiKey?, useByoKey }` (→ `ProviderCredential`; `apiKey` write-only) · `DELETE /workspaces/WS/enrichment/credentials/{credentialId}` → `204`.
- `ai.models.list(ws)` / `agent.models.list(ws)` → `GET /workspaces/WS/ai/models` → `200 AiModelInfo[]` (agent reuses the AI catalog; `providerCostUsd` redacted to `0` for non-admin).
- `http.secrets` — `GET /workspaces/WS/http/secrets` (→ `HttpSecret[]`, masked) · `POST /workspaces/WS/http/secrets` body `{ name, token }` (→ `HttpSecret`, masked; `token` write-only) · `DELETE /workspaces/WS/http/secrets/{secretId}` → `204`.

### 5.11 `formula` — `FormulaApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `get(columnId)` | GET | `/columns/{columnId}/formula-config` | — | `200 FormulaColumnConfig \| null` | 404 |
| `list(tableId)` | GET | `/tables/{tableId}/formula-configs` | — | `200 FormulaColumnConfig[]` | 404 |
| `upsert({columnId, expression})` | PUT | `/columns/{columnId}/formula-config` | `{ expression }` | `200 FormulaColumnConfig` | 403, 404, 422 |
| `remove(columnId)` | DELETE | `/columns/{columnId}/formula-config` | — | `204` | 403, 404 |
| `validate(expression)` | POST | `/formula/validate` | `{ expression }` | `200 { error: string \| null }` | 422 |
| `recomputeTable(tableId)` | POST | `/tables/{tableId}/formula/recompute` | — | `200 { computed: number, errors: number }` | 403, 404 |

### 5.12 `automation` — `AutomationApi`

**`automations` (`AutomationsApi`):**

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/workspaces/WS/automations` | — | `200 Automation[]` | 403 |
| `upsert(ws, input)` — create | POST | `/workspaces/WS/automations` | `UpsertAutomationInput` (no `id`) | `201 Automation` | 403, 404, 422 |
| `upsert(ws, input)` — update | PATCH | `/workspaces/WS/automations/{id}` | `UpsertAutomationInput` (with `id`) | `200 Automation` | 403, 404, 422 |
| `setEnabled(ws, id, enabled)` | PATCH | `/workspaces/WS/automations/{id}` | `{ isEnabled: enabled }` | `200 Automation` | 403, 404 |
| `remove(ws, id)` | DELETE | `/workspaces/WS/automations/{id}` | — | `204` | 403, 404 |
| `runNow(ws, id)` | POST | `/workspaces/WS/automations/{id}/run` | — | `200 AutomationRun` | 402, 403, 404 |
| `runs(ws, {automationId?, limit?})` | GET | `/workspaces/WS/automation-runs?automationId=&limit=` | — | `200 AutomationRun[]` | 403 |

`UpsertAutomationInput = { id?, tableId, name, trigger, action, targetColumnId?, forceFresh?, schedule?, rowEvent?, isEnabled? }`. `HttpApi` routes to POST vs PATCH on `input.id`.

**`webhooks` (`WebhooksApi`):**

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `listInbound(ws)` | GET | `/workspaces/WS/webhooks/inbound` | — | `200 InboundWebhook[]` | 403 |
| `createInbound(ws, input)` | POST | `/workspaces/WS/webhooks/inbound` | `UpsertInboundWebhookInput` `{ id?, tableId, name, mapping, isEnabled? }` | `201 { webhook: InboundWebhook, url, secret }` | 403, 404, 422 |
| `setInboundEnabled(ws, id, enabled)` | PATCH | `/workspaces/WS/webhooks/inbound/{id}` | `{ isEnabled: enabled }` | `200 InboundWebhook` | 403, 404 |
| `removeInbound(ws, id)` | DELETE | `/workspaces/WS/webhooks/inbound/{id}` | — | `204` | 403, 404 |
| `simulateInbound(slug, secret, payload)` | POST | `/hooks/in/{slug}` **(public ingest)** | header `X-Cascade-Webhook-Secret: <secret>`, body = `payload` | `200 { ok, recordId?, reason? }` | 401 (bad secret), 404 |
| `listOutbound(ws)` | GET | `/workspaces/WS/webhooks/outbound` | — | `200 OutboundWebhook[]` | 403 |
| `createOutbound(ws, input)` | POST | `/workspaces/WS/webhooks/outbound` | `UpsertOutboundWebhookInput` `{ id?, tableId, name, url, event, condition?, fieldColumnIds?, isEnabled? }` | `201 OutboundWebhook` | 403, 404, 422 |
| `setOutboundEnabled(ws, id, enabled)` | PATCH | `/workspaces/WS/webhooks/outbound/{id}` | `{ isEnabled: enabled }` | `200 OutboundWebhook` | 403, 404 |
| `removeOutbound(ws, id)` | DELETE | `/workspaces/WS/webhooks/outbound/{id}` | — | `204` | 403, 404 |

> `createInbound`'s `{ url, secret }` are shown **once**; subsequent reads mask the secret (FR-3.5). The public ingest `POST /hooks/in/{slug}` is **not** bearer-authed — the `slug` + secret are the credential. Note it sits at `/v1/hooks/in/{slug}` (or an unversioned public path if preferred by infra).

### 5.13 `integration` — `IntegrationApi`

**`crm` (`CrmApi`):**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/workspaces/WS/integrations/crm` | — | `200 CrmConnection[]` |
| `connect(ws, input)` | POST | `/workspaces/WS/integrations/crm` | `ConnectCrmInput` `{ provider, token, accountLabel, tableId, fieldMapping?, dedupeColumnId? }` | `201 CrmConnection` |
| `updateMapping(ws, id, patch)` | PATCH | `/workspaces/WS/integrations/crm/{id}` | `{ fieldMapping?, dedupeColumnId? }` | `200 CrmConnection` |
| `disconnect(ws, id)` | DELETE | `/workspaces/WS/integrations/crm/{id}` | — | `204` |
| `sync(ws, id, direction)` | POST | `/workspaces/WS/integrations/crm/{id}/sync` | `{ direction: 'push'\|'pull' }` | `200 CrmSyncRun` |
| `syncRuns(ws, {connectionId?, limit?})` | GET | `/workspaces/WS/integrations/crm/sync-runs?connectionId=&limit=` | — | `200 CrmSyncRun[]` |

**`slack` (`SlackApi`):**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `get(ws)` | GET | `/workspaces/WS/integrations/slack` | — | `200 SlackConnection \| null` |
| `connect(ws, input)` | POST | `/workspaces/WS/integrations/slack` | `ConnectSlackInput` `{ token, teamName, defaultChannel }` | `201 SlackConnection` |
| `disconnect(ws)` | DELETE | `/workspaces/WS/integrations/slack` | — | `204` |
| `notify(ws, {channel?, text})` | POST | `/workspaces/WS/integrations/slack/notify` | `{ channel?, text }` | `200 { ok }` |

**`sequencers` (`SequencerApi`):**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/workspaces/WS/integrations/sequencers` | — | `200 SequencerConnection[]` |
| `connect(ws, input)` | POST | `/workspaces/WS/integrations/sequencers` | `ConnectSequencerInput` `{ provider, token, accountLabel }` | `201 SequencerConnection` |
| `disconnect(ws, id)` | DELETE | `/workspaces/WS/integrations/sequencers/{id}` | — | `204` |
| `campaigns(ws, id)` | GET | `/workspaces/WS/integrations/sequencers/{id}/campaigns` | — | `200 SequencerCampaign[]` |
| `push(ws, id, input)` | POST | `/workspaces/WS/integrations/sequencers/{id}/push` | `PushToSequencerInput` `{ tableId, campaignId, campaignName, fieldMapping, filter?, recordIds? }` | `200 SequencerPushRun` |
| `pushRuns(ws, {connectionId?, limit?})` | GET | `/workspaces/WS/integrations/sequencers/push-runs?connectionId=&limit=` | — | `200 SequencerPushRun[]` |

**events:**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `events(ws, {source?, limit?, offset?})` | GET | `/workspaces/WS/integrations/events?source=&limit=&offset=` | — | `200 IntegrationEvent[]` |

### 5.14 `templates` — `TemplatesApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `list()` | GET | `/templates` | — | `200 Template[]` | — |
| `get(templateId)` | GET | `/templates/{templateId}` | — | `200 Template \| null` | — |
| `instantiate(ws, templateId, {tableName?})` | POST | `/workspaces/WS/templates/{templateId}/instantiate` | `{ tableName? }` | `201 TableMeta` | 403, 404, 422 |

### 5.15 `onboarding` — `OnboardingApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `get(ws)` | GET | `/workspaces/WS/onboarding` | — | `200 OnboardingState` | 403 |
| `complete(ws, {tableId?})` | POST | `/workspaces/WS/onboarding/complete` | `{ tableId? }` | `200 OnboardingState` | 403 |
| `skip(ws)` | POST | `/workspaces/WS/onboarding/skip` | — | `200 OnboardingState` | 403 |
| `reset(ws)` | POST | `/workspaces/WS/onboarding/reset` | — | `200 OnboardingState` | 403 |

### 5.16 `credits` — `CreditsApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `balance(ws)` | GET | `/workspaces/WS/credits/balance` | — | `200 BalanceInfo` | 403 |
| `budget.get(ws)` | GET | `/workspaces/WS/credits/budget` | — | `200 BudgetSettings` | 403 |
| `budget.set(ws, patch)` | PATCH | `/workspaces/WS/credits/budget` | `{ budgetCap?, perRunCap? }` | `200 BudgetSettings` | 403, 422 |
| `ledger(ws, {runId?, limit?, offset?})` | GET | `/workspaces/WS/credits/ledger?runId=&limit=&offset=` | — | `200 CreditLedgerEntry[]` | 403 |
| `consumptionByProvider(ws, {since?})` | GET | `/workspaces/WS/credits/consumption?groupBy=provider&since=` | — | `200 ConsumptionBucket[]` | 403 |
| `consumptionByColumn(ws, {since?})` | GET | `…?groupBy=column&since=` | — | `200 ConsumptionBucket[]` | 403 |
| `consumptionByTable(ws, {since?})` | GET | `…?groupBy=table&since=` | — | `200 ConsumptionBucket[]` | 403 |
| `consumptionByModel(ws, {since?})` | GET | `…?groupBy=model&since=` | — | `200 ConsumptionBucket[]` | 403 |

One consumption endpoint with `groupBy ∈ provider|column|table|model` backs the four methods.

### 5.17 `billing` — `BillingApi`

| Method | HTTP | Path | Request | → Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `plans.list()` | GET | `/plans` | — | `200 Plan[]` | — |
| `summary(ws)` | GET | `/workspaces/WS/billing/summary` | — | `200 BillingSummary` | 403 |
| `changePlan(ws, planId)` | POST | `/workspaces/WS/billing/change-plan` | `{ planId }` | `200 Subscription` | 403, 404, 422 |
| `setCancel(ws, cancelAtPeriodEnd)` | POST | `/workspaces/WS/billing/cancel` | `{ cancelAtPeriodEnd }` | `200 Subscription` | 403 |
| `purchaseCredits(ws, {credits, amountUsd})` | POST | `/workspaces/WS/billing/purchase-credits` | `{ credits, amountUsd }` | `201 CreditPurchase` | 403, 422 |
| `purchases(ws)` | GET | `/workspaces/WS/billing/purchases` | — | `200 CreditPurchase[]` | 403 |
| `invoices(ws)` | GET | `/workspaces/WS/billing/invoices` | — | `200 Invoice[]` | 403 |
| `seatUsage(ws)` | GET | `/workspaces/WS/billing/seats` | — | `200 SeatUsage` | 403 |

### 5.18 `platform` — `PlatformApi` (separate superadmin identity)

All `/platform/*` calls carry the **`PlatformSession.token`** bearer (not a workspace token). Cross-tenant reads are permitted here by design (FR-4.2).

**`auth`:**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `signIn(email, password?)` | POST | `/platform/auth/sign-in` | `{ email, password? }` | `200 PlatformSession` |
| `currentSession()` | GET | `/platform/auth/session` | — | `200 PlatformSession \| null` |
| `signOut()` | POST | `/platform/auth/sign-out` | — | `204` |

**`workspaces`:**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `list()` | GET | `/platform/workspaces` | — | `200 PlatformWorkspaceSummary[]` |
| `get(ws)` | GET | `/platform/workspaces/{ws}` | — | `200 PlatformWorkspaceSummary` |
| `members(ws)` | GET | `/platform/workspaces/{ws}/members` | — | `200 Member[]` |
| `setSuspended(ws, suspended, reason)` | POST | `/platform/workspaces/{ws}/suspension` | `{ suspended, reason }` | `200 Workspace` |
| `deactivateUser(ws, userId, reason)` | POST | `/platform/workspaces/{ws}/members/{userId}/deactivate` | `{ reason }` | `204` |
| `compCredits(ws, credits, reason)` | POST | `/platform/workspaces/{ws}/comp-credits` | `{ credits, reason }` | `204` |
| `overridePlan(ws, planId, reason)` | POST | `/platform/workspaces/{ws}/override-plan` | `{ planId, reason }` | `200 Subscription` |

**`invoices`:**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `list(ws)` | GET | `/platform/workspaces/{ws}/invoices` | — | `200 Invoice[]` |
| `refund(invoiceId, reason)` | POST | `/platform/invoices/{invoiceId}/refund` | `{ reason }` | `200 Invoice` |

**top-level:**

| Method | HTTP | Path | Request | → Response |
| --- | --- | --- | --- | --- |
| `analytics({since?})` | GET | `/platform/analytics?since=` | — | `200 PlatformAnalytics` |
| `audit({limit?, offset?})` | GET | `/platform/audit?limit=&offset=` | — | `200 PlatformAuditEntry[]` |

`reason` on the superadmin mutations is required (audited actions, US-4.5/4.6).

---

## 6. Open questions for the backend team

1. **`switchUser`** — keep in production (impersonation, audited) or restrict to dev/demo? Affects whether `HttpApi` exposes it against prod.
2. **SSE auth** — confirm the `fetch`-stream-reader approach (Bearer header preserved) vs. the `POST /stream/ticket` fallback for raw `EventSource`.
3. **Cell-status polling** — is the proposed `GET /tables/{tableId}/cell-status?since=` delta endpoint acceptable as the streaming fallback, or should the client re-read `…-results`?
4. **401 taxonomy** — ✅ **resolved.** `UnauthorizedError` (401, code `unauthorized`) added to `errors.ts`; `HttpApi` maps 401 → it and clears the stored token.
5. **Idempotency** — should mutating POSTs (`run`, `purchaseCredits`, `push`) accept an `Idempotency-Key` header to make retries safe?
