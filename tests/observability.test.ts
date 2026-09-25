// Error tracing: request IDs, the 5xx reference, Sentry capture and scrubbing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbMock } from './setup.js'
import { accessToken, authHeaders, getApp } from './helpers.js'
import { scrubEvent, scrubString, REDACTED } from '../src/lib/observability-scrub.js'
import { genRequestId } from '../src/lib/observability.js'

// Pretend Sentry is configured, and record what would have been sent.
const sent = vi.hoisted(() => ({
  captured: [] as { error: unknown; tags: Record<string, string>; user?: { id: string } }[],
}))

vi.mock('@sentry/node', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sentry/node')>()
  return {
    ...real,
    isEnabled: () => true,
    withScope: (fn: (scope: unknown) => unknown) => {
      const tags: Record<string, string> = {}
      let user: { id: string } | undefined
      const scope = {
        setTag: (k: string, v: string) => { tags[k] = v },
        setUser: (u: { id: string }) => { user = u },
        setTransactionName: () => {},
        setExtras: () => {},
        setLevel: () => {},
      }
      const result = fn(scope)
      const last = sent.captured[sent.captured.length - 1]
      if (last) { last.tags = tags; last.user = user }
      return result
    },
    captureException: (error: unknown) => {
      sent.captured.push({ error, tags: {} })
      return 'evt_123'
    },
  }
})

beforeEach(() => {
  sent.captured.length = 0
})

describe('request IDs', () => {
  it('returns an X-Request-Id on every response', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reuses a sane ID sent by the browser', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'web-7f3a9c21-abcd' } })
    expect(res.headers['x-request-id']).toBe('web-7f3a9c21-abcd')
  })

  it('ignores an ID that could be used to inject into logs', () => {
    const id = genRequestId({ headers: { 'x-request-id': 'bad id\nFAKE LOG LINE' } })
    expect(id).not.toContain('\n')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(genRequestId({ headers: { 'x-request-id': 'x'.repeat(200) } })).toHaveLength(36)
  })
})

describe('server errors', () => {
  it('reports a 500 to Sentry with the request ID and route, and gives the client the reference', async () => {
    const app = await getApp()
    dbMock.blogPost.findMany.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:3306'))
    dbMock.blogPost.count.mockResolvedValue(0)

    const res = await app.inject({ method: 'GET', url: '/api/blog', headers: { 'x-request-id': 'web-ref-00000001' } })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    // The coach sees a reference, never the database host.
    expect(body.requestId).toBe('web-ref-00000001')
    expect(body.message).toBe('Internal Server Error')
    expect(JSON.stringify(body)).not.toContain('db.internal')

    expect(sent.captured).toHaveLength(1)
    expect(sent.captured[0].tags).toMatchObject({ request_id: 'web-ref-00000001', route: '/api/blog', status: '500' })
  })

  it('does not report client errors (4xx)', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/users/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().requestId).toBeUndefined()
    expect(sent.captured).toHaveLength(0)
  })
})

describe('scrubbing', () => {
  it('removes JWTs, reset tokens and guardian links from strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMywidHlwZSI6Imd1YXJkaWFuIn0.abcdefghijklmnop'
    expect(scrubString(`GET /api/feedback/guardian/${jwt}`)).not.toContain(jwt)
    expect(scrubString('/reset-password?token=abc123secret&x=1')).toBe(`/reset-password?token=${REDACTED}&x=1`)
  })

  it('drops bodies, cookies, auth headers and everything but the user ID', () => {
    const event = scrubEvent({
      request: {
        url: '/api/auth/login',
        headers: { authorization: 'Bearer abc', 'user-agent': 'Safari' },
        cookies: { session: 'x' },
        data: { email: 'coach@club.com', password: 'hunter2' },
      },
      user: { id: '42', email: 'coach@club.com', ip_address: '1.2.3.4' },
      extra: { refreshToken: 'r', note: 'fine' },
    })
    expect(event.request.headers.authorization).toBe(REDACTED)
    expect(event.request.headers['user-agent']).toBe('Safari')
    expect(event.request).not.toHaveProperty('data')
    expect(event.request).not.toHaveProperty('cookies')
    expect(event.user).toEqual({ id: '42' })
    expect(event.extra).toEqual({ refreshToken: REDACTED, note: 'fine' })
  })
})

describe('owner test endpoint', () => {
  it('is closed to the public', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/admin/monitoring/test' })
    expect(res.statusCode).toBe(401)
    expect(sent.captured).toHaveLength(0)
  })
  it('for the owner: a 500 reported with their account ID', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    const res = await app.inject({
      method: 'POST', url: '/api/admin/monitoring/test', headers: authHeaders(await accessToken(7)),
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().requestId).toBeTruthy()
    expect(sent.captured).toHaveLength(1)
    expect(sent.captured[0].user).toEqual({ id: '7' })
    expect(sent.captured[0].tags.route).toBe('/api/admin/monitoring/test')
  })
})
