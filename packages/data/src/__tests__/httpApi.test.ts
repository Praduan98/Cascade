// Behavioral tests for HttpApi's transport layer, driven by an injected fake
// fetch (no network). `implements CascadeApi` already proves every method's
// shape at compile time; these cover the runtime concerns that types can't:
// URL/query building, Bearer attachment + token lifecycle, the status→error
// taxonomy mapping, 204/void, envelope unwrapping, GET-vs-POST record listing,
// and the fetch-SSE subscribe fan-out.

import { describe, expect, it, vi } from 'vitest'
import { HttpApi } from '../httpApi'
import { BudgetError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../errors'

const BASE = 'https://api.test/v1'
const SESSION = { user: { id: 'u1' }, workspaceId: 'ws1', role: 'owner', token: 'tok-123', expiresAt: '2030-01-01' }

/** Cast an arbitrary handler to the global fetch signature. */
function fake(fn: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return ((url: unknown, init: unknown) => fn(String(url), (init ?? {}) as RequestInit)) as unknown as typeof fetch
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function apiError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })
}

describe('HttpApi — request core', () => {
  it('signs in, remembers the token, and sends it as a Bearer header on later calls', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url, init) => {
        calls.push({ url, init })
        return url.endsWith('/auth/sign-in') ? json(SESSION) : json([])
      }),
    })

    const session = await api.auth.signIn('a@b.com', 'pw')
    expect(session.token).toBe('tok-123')

    await api.workspaces.list()
    const last = calls[calls.length - 1]!
    expect(last.url).toBe(`${BASE}/workspaces`)
    expect((last.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
  })

  it('builds the query string, skipping undefined params', async () => {
    let seen = ''
    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url) => {
        seen = url
        return json([])
      }),
    })
    await api.audit.list('ws1', { limit: 25 }) // offset is undefined → omitted
    expect(seen).toBe(`${BASE}/workspaces/ws1/audit?limit=25`)
  })

  it('treats 204 as a void success', async () => {
    const api = new HttpApi({ baseUrl: BASE, fetch: fake(async () => new Response(null, { status: 204 })) })
    await expect(api.tables.remove('tbl_1')).resolves.toBeUndefined()
  })

  it('unwraps envelope results — count and GET-vs-POST record listing', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url, init) => {
        calls.push({ method: init.method as string, url })
        if (url.includes('/records/count')) return json({ count: 42 })
        return json({ rows: [], total: 0 })
      }),
    })

    expect(await api.records.count('tbl_1')).toBe(42)
    await api.records.list('tbl_1', { limit: 10 }) // simple → GET
    await api.records.list('tbl_1', { sorts: [{ columnId: 'c', dir: 'asc' }] }) // filters/sorts → POST query

    expect(calls.some((c) => c.method === 'GET' && c.url.includes('/tables/tbl_1/records?'))).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tables/tbl_1/records/query'))).toBe(true)
  })
})

describe('HttpApi — error mapping', () => {
  it('maps each status onto its errors.ts class', async () => {
    const cases: Array<[number, Record<string, unknown>, new (...a: never[]) => Error]> = [
      [402, { code: 'budget', message: 'x' }, BudgetError],
      [403, { code: 'forbidden', message: 'x' }, ForbiddenError],
      [404, { code: 'not_found', message: 'x' }, NotFoundError],
      [409, { code: 'conflict', message: 'x' }, ConflictError],
      [422, { code: 'validation', message: 'x' }, ValidationError],
    ]
    for (const [status, error, Cls] of cases) {
      const api = new HttpApi({ baseUrl: BASE, fetch: fake(async () => apiError(status, error)) })
      await expect(api.workspaces.list()).rejects.toBeInstanceOf(Cls)
    }
  })

  it('preserves structured detail on Budget / Conflict / Validation errors', async () => {
    const budget = new HttpApi({ baseUrl: BASE, fetch: fake(async () => apiError(402, { message: 'no', maxCredits: 50, cap: 40 })) })
    await budget.workspaces.list().then(
      () => expect.unreachable('should reject'),
      (e: BudgetError) => {
        expect(e).toBeInstanceOf(BudgetError)
        expect(e.maxCredits).toBe(50)
        expect(e.cap).toBe(40)
      },
    )

    const conflict = new HttpApi({ baseUrl: BASE, fetch: fake(async () => apiError(409, { message: 'stale', currentValue: 7 })) })
    await conflict.workspaces.list().then(
      () => expect.unreachable('should reject'),
      (e: ConflictError) => expect(e.currentValue).toBe(7),
    )

    const invalid = new HttpApi({ baseUrl: BASE, fetch: fake(async () => apiError(422, { message: 'bad', fields: { email: 'required' } })) })
    await invalid.workspaces.list().then(
      () => expect.unreachable('should reject'),
      (e: ValidationError) => expect(e.fields?.email).toBe('required'),
    )
  })

  it('maps 401 to UnauthorizedError and clears the stored token', async () => {
    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url) =>
        url.endsWith('/auth/sign-in') ? json(SESSION) : apiError(401, { code: 'token_expired', message: 'expired' }),
      ),
    })
    await api.auth.signIn('a@b.com')
    await expect(api.workspaces.list()).rejects.toBeInstanceOf(UnauthorizedError)
    // token was cleared; currentSession swallows the follow-up 401 → null
    expect(await api.auth.currentSession()).toBeNull()
  })
})

describe('HttpApi — SSE transport', () => {
  it('subscribes over the fetch stream, fans a cell event to the matching callback, and unsubscribes', async () => {
    const enc = new TextEncoder()
    const frame =
      'id: 1\nevent: cascade\ndata: ' +
      JSON.stringify({
        kind: 'enrichment',
        event: { type: 'cell', runId: 'run1', tableId: 'tbl_1', recordId: 'rec_1', columnId: 'col_1', meta: { status: 'running' } },
      }) +
      '\n\n'

    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url) => {
        if (url.includes('/stream')) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(enc.encode(frame))
              // leave the stream open (a live tail); the test unsubscribes to close it
            },
          })
          return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        }
        return json(SESSION)
      }),
    })

    await api.auth.signIn('a@b.com') // populates the per-workspace stream scope
    const received: Array<{ type: string; meta?: { status?: string } }> = []
    const unsub = api.enrichment.subscribe({ tableId: 'tbl_1' }, (e) => received.push(e as never))

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]!.type).toBe('cell')
    expect(received[0]!.meta?.status).toBe('running')

    unsub() // closes the socket; no dangling reconnect timer
  })

  it('does not deliver events for a different run to a run-scoped subscriber', async () => {
    const enc = new TextEncoder()
    const frame =
      'id: 1\ndata: ' +
      JSON.stringify({ kind: 'enrichment', event: { type: 'cell', runId: 'other-run', tableId: 'tbl_1', recordId: 'r', columnId: 'c', meta: {} } }) +
      '\n\n'
    const api = new HttpApi({
      baseUrl: BASE,
      fetch: fake(async (url) => {
        if (url.includes('/stream')) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(enc.encode(frame))
            },
          })
          return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        }
        return json(SESSION)
      }),
    })
    await api.auth.signIn('a@b.com')
    const received: unknown[] = []
    const unsub = api.enrichment.subscribe({ runId: 'my-run' }, (e) => received.push(e))
    // give the frame time to arrive and be filtered out
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(0)
    unsub()
  })
})
