// PERF (5 Oct 2026) — backend request optimisations from the hosting review
// (TACTICAL_COACH/Hosting_and_Backend_Review_2026-10-05.md):
//   1. media URLs stay the same within a signing window, so browsers cache them
//   2. JSON responses are gzip-compressed
//   3. list `limit` / `page` are clamped

import { describe, it, expect, vi, afterEach } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { pageParams, MAX_LIMIT } from '../src/lib/paging.js'
import { env } from '../src/config/env.js'

type S3Module = typeof import('../src/config/s3.js')

describe('PERF · paging is clamped', () => {
  it('defaults, caps at 100, and ignores nonsense', () => {
    expect(pageParams({})).toEqual({ page: 1, limit: 20, skip: 0 })
    expect(pageParams({ limit: '100000', page: '2' })).toEqual({ page: 2, limit: MAX_LIMIT, skip: MAX_LIMIT })
    expect(pageParams({ limit: '-5', page: 'abc' })).toEqual({ page: 1, limit: 20, skip: 0 })
    expect(pageParams({ limit: '60' }).limit).toBe(60) // the community library asks for 60
    expect(pageParams({ limit: '100' }).limit).toBe(100) // the coach's own library asks for 100
  })

  it('GET /api/canvas/boards?limit=100000 asks the database for at most 100 rows', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.canvasBoard.count.mockResolvedValue(0 as never)
    const res = await app.inject({ method: 'GET', url: '/api/canvas/boards?limit=100000&page=1', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(dbMock.canvasBoard.findMany.mock.calls.at(-1)?.[0]?.take).toBe(100)
    expect(res.json().limit).toBe(100)
  })

  it('the community library and the drill-sheet gallery are clamped too', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.canvasBoard.count.mockResolvedValue(0 as never)
    await app.inject({ method: 'GET', url: '/api/canvas/library?limit=99999', headers: authHeaders(await accessToken()) })
    expect(dbMock.canvasBoard.findMany.mock.calls.at(-1)?.[0]?.take).toBe(100)
    dbMock.drillSheet.findMany.mockResolvedValue([] as never)
    dbMock.drillSheet.count.mockResolvedValue(0 as never)
    await app.inject({ method: 'GET', url: '/api/drill-sheets/gallery?limit=99999', headers: authHeaders(await accessToken()) })
    expect(dbMock.drillSheet.findMany.mock.calls.at(-1)?.[0]?.take).toBe(100)
  })
})

describe('PAGING · the community library searches on the server', () => {
  it('?q= filters by title, coach or club — and the count uses the same filter', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.canvasBoard.count.mockResolvedValue(0 as never)
    await app.inject({ method: 'GET', url: '/api/canvas/library?page=2&limit=12&q=press', headers: authHeaders(await accessToken()) })
    const args = dbMock.canvasBoard.findMany.mock.calls.at(-1)?.[0]
    expect(args?.skip).toBe(12)
    expect(args?.take).toBe(12)
    expect(args?.where).toMatchObject({ published: true })
    expect(JSON.stringify(args?.where)).toContain('"title":{"contains":"press"}')
    expect(JSON.stringify(args?.where)).toContain('"clubName":{"contains":"press"}')
    expect(dbMock.canvasBoard.count.mock.calls.at(-1)?.[0]).toEqual({ where: args?.where })
  })

  it('no search: every published board', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.canvasBoard.count.mockResolvedValue(0 as never)
    await app.inject({ method: 'GET', url: '/api/canvas/library', headers: authHeaders(await accessToken()) })
    expect(dbMock.canvasBoard.findMany.mock.calls.at(-1)?.[0]?.where).toEqual({ published: true })
  })
})

describe('PERF · JSON is compressed', () => {
  it('a large list comes back gzipped when the browser accepts it — and decodes to the same JSON', async () => {
    const app = await getApp()
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, userId: 1, title: `Pressing drill number ${i + 1} with a long title`, pitchKey: 'classic',
      thumbnailKey: null, videoKey: null, published: false, publishedAt: null, createdAt: new Date(), updatedAt: new Date(),
      tags: ['pressing', 'transition'], _count: { likes: 0 },
    }))
    dbMock.canvasBoard.findMany.mockResolvedValue(rows as never)
    dbMock.canvasBoard.count.mockResolvedValue(rows.length as never)
    const res = await app.inject({
      method: 'GET', url: '/api/canvas/boards?limit=40',
      headers: { ...authHeaders(await accessToken()), 'accept-encoding': 'gzip' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    const body = JSON.parse(gunzipSync(res.rawPayload).toString('utf8'))
    expect(body.boards).toHaveLength(40)
    expect(res.rawPayload.length).toBeLessThan(JSON.stringify(body).length / 3)
  })

  it('small responses and clients that do not ask stay uncompressed', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.canvasBoard.count.mockResolvedValue(0 as never)
    const res = await app.inject({ method: 'GET', url: '/api/canvas/boards', headers: authHeaders(await accessToken()) })
    expect(res.headers['content-encoding']).toBeUndefined()
  })
})

describe('PERF · media URLs are cacheable', () => {
  const saved = { ...env }
  afterEach(() => {
    Object.assign(env, saved)
    vi.useRealTimers()
  })

  async function realS3(): Promise<S3Module> {
    Object.assign(env, { AWS_REGION: 'eu-north-1', AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'secret', S3_BUCKET: 'tc-test' })
    return vi.importActual<S3Module>('../src/config/s3.js')
  }

  it('the same object gets the SAME URL within a window (so the browser reuses it) and a new one after', async () => {
    const s3 = await realS3()
    vi.useFakeTimers()
    const start = s3.signWindowStart(Date.UTC(2026, 9, 5, 12, 0, 0))
    vi.setSystemTime(start + 1000)
    const a = await s3.presignUrl('boards/1/10/thumb-1.webp')
    vi.setSystemTime(start + s3.SIGN_WINDOW_MS - 1000)
    const b = await s3.presignUrl('boards/1/10/thumb-1.webp')
    expect(a).toBe(b)
    vi.setSystemTime(start + s3.SIGN_WINDOW_MS + 1000)
    const c = await s3.presignUrl('boards/1/10/thumb-1.webp')
    expect(c).not.toBe(a)
  })

  it('a URL handed out at the end of its window is still valid for at least a whole window', async () => {
    const s3 = await realS3()
    vi.useFakeTimers()
    const start = s3.signWindowStart(Date.UTC(2026, 9, 5, 12, 0, 0))
    vi.setSystemTime(start + s3.SIGN_WINDOW_MS - 1)
    const url = new URL((await s3.presignUrl('boards/1/10/video-1.mp4'))!)
    const expires = Number(url.searchParams.get('X-Amz-Expires'))
    const signedAt = url.searchParams.get('X-Amz-Date')!
    const signedMs = Date.UTC(+signedAt.slice(0, 4), +signedAt.slice(4, 6) - 1, +signedAt.slice(6, 8), +signedAt.slice(9, 11), +signedAt.slice(11, 13), +signedAt.slice(13, 15))
    expect(signedMs).toBe(start)
    expect(signedMs + expires * 1000 - Date.now()).toBeGreaterThanOrEqual(s3.SIGN_WINDOW_MS)
    // …and the browser is told it may cache the file (also for files uploaded before this change).
    expect(url.searchParams.get('response-cache-control')).toContain('max-age=')
  })

  it('files stored on the server disk (no S3 yet) are cached for a year too', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/config/s3.ts', 'utf8'))
    expect(src).toContain("reply.header('Cache-Control', 'public, max-age=31536000, immutable')")
    expect(src).not.toContain("'public, max-age=3600'")
  })

  it('E2E-07 · files on the server disk may be shown in an <img> on the web app (Helmet would refuse)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/config/s3.ts', 'utf8'))
    const route = src.slice(src.indexOf("app.get('/uploads/*'"))
    expect(route).toContain("reply.header('Cross-Origin-Resource-Policy', 'cross-origin')")
  })

  it('uploads are stored as immutable (every key is unique, so a file never changes)', async () => {
    const s3 = await realS3()
    expect(s3.MEDIA_CACHE_CONTROL).toContain('immutable')
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/config/s3.ts', 'utf8'))
    expect(src).toContain('CacheControl: MEDIA_CACHE_CONTROL')
  })
})
