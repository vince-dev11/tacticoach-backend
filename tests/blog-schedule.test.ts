// BLOG-SCHEDULE (27 Nov 2026, owner: "we can schedule a blog post and the blog
// will post at that date and time"). A scheduled post is `published` with a
// future publish date; every public read only returns posts whose date has
// arrived. No background job.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { livePosts } from '../src/modules/blog/blog.routes.js'
import { goesLiveAt } from '../src/modules/admin/admin.routes.js'

const now = new Date('2026-11-27T10:00:00Z')
const future = '2026-12-01T09:00:00.000Z'
const past = new Date('2026-11-20T09:00:00Z')

const postRow = (o: Record<string, unknown> = {}) => ({
  id: 1, slug: 'rondo', title: 'Rondo', excerpt: null, content: 'x', coverImageKey: null, tags: [], status: 'draft',
  publishedAt: null, authorId: 1, authorKind: 'team', seoTitle: null, seoDescription: null, readMinutes: 1,
  createdAt: new Date(), updatedAt: new Date(), ...o,
})
const owner = () => dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'owner', accountType: 'coach' } as never)

beforeEach(() => { vi.clearAllMocks() })

describe('BLOG-SCHEDULE · when a post goes live', () => {
  it('a future time schedules it; no time, or a past one, is now', () => {
    expect(goesLiveAt(future, null, now)).toEqual(new Date(future))
    expect(goesLiveAt(null, null, now)).toEqual(now)
    expect(goesLiveAt('2026-11-01T00:00:00Z', null, now)).toEqual(now)
  })
  it('a post already live keeps its first publish date; a scheduled one can be moved or published now', () => {
    expect(goesLiveAt(undefined, past, now)).toEqual(past)
    expect(goesLiveAt(null, past, now)).toEqual(past)
    expect(goesLiveAt(null, new Date(future), now)).toEqual(now) // "publish now" on a scheduled post
    expect(goesLiveAt('2026-12-05T09:00:00.000Z', new Date(future), now)).toEqual(new Date('2026-12-05T09:00:00.000Z'))
    expect(goesLiveAt(undefined, new Date(future), now)).toEqual(new Date(future)) // an edit that doesn't touch the date
  })
})

describe('BLOG-SCHEDULE · the public blog never shows a post before its time', () => {
  it('list, single post, RSS and sitemap all ask for posts whose date has arrived', async () => {
    expect(livePosts(now)).toEqual({ status: 'published', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] })
    const app = await getApp()
    dbMock.blogPost.findMany.mockResolvedValue([] as never)
    dbMock.blogPost.count.mockResolvedValue(0 as never)
    dbMock.blogPost.findFirst.mockResolvedValue(null as never)
    const live = expect.objectContaining({ status: 'published', OR: [{ publishedAt: null }, { publishedAt: { lte: expect.any(Date) } }] })

    await app.inject({ method: 'GET', url: '/api/blog' })
    await app.inject({ method: 'GET', url: '/api/blog/rss.xml' })
    await app.inject({ method: 'GET', url: '/api/blog/sitemap.xml' })
    for (const call of dbMock.blogPost.findMany.mock.calls) expect(call[0]!.where).toEqual(live)
    expect(dbMock.blogPost.findMany).toHaveBeenCalledTimes(3)

    const res = await app.inject({ method: 'GET', url: '/api/blog/rondo' })
    expect(res.statusCode).toBe(404) // a scheduled post's link is "not found" until its time
    expect(dbMock.blogPost.findFirst.mock.calls[0][0]!.where).toEqual(expect.objectContaining({ slug: 'rondo', status: 'published' }))
    expect(dbMock.blogPost.findFirst.mock.calls[0][0]!.where).toHaveProperty('OR')
  })
})

describe('BLOG-SCHEDULE · Admin', () => {
  it('publishing with a future time saves that time; without one, now', async () => {
    const app = await getApp()
    owner()
    dbMock.blogPost.findUnique.mockResolvedValue(postRow() as never)
    dbMock.blogPost.update.mockResolvedValue(postRow({ status: 'published' }) as never)
    const farFuture = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/blog/1', headers: authHeaders(await accessToken()), payload: { status: 'published', publishAt: farFuture } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.blogPost.update.mock.calls[0][0].data.publishedAt).toEqual(new Date(farFuture))
  })

  it('a scheduled post can be moved without sending the status again', async () => {
    const app = await getApp()
    owner()
    const was = new Date(Date.now() + 2 * 86_400_000)
    const to = new Date(Date.now() + 5 * 86_400_000).toISOString()
    dbMock.blogPost.findUnique.mockResolvedValue(postRow({ status: 'published', publishedAt: was }) as never)
    dbMock.blogPost.update.mockResolvedValue(postRow({ status: 'published' }) as never)
    await app.inject({ method: 'PATCH', url: '/api/admin/blog/1', headers: authHeaders(await accessToken()), payload: { publishAt: to } })
    expect(dbMock.blogPost.update.mock.calls[0][0].data.publishedAt).toEqual(new Date(to))
  })

  it('a date that is not a date is refused with a clear message', async () => {
    const app = await getApp()
    owner()
    dbMock.blogPost.findUnique.mockResolvedValue(postRow() as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/blog/1', headers: authHeaders(await accessToken()), payload: { status: 'published', publishAt: 'next tuesday' } })
    expect(res.statusCode).toBe(422)
  })

  it('BLOG-PATCH-DEFAULTS: saving only the SEO fields leaves content, tags and status alone (the Approve flow does this)', async () => {
    const app = await getApp()
    owner()
    dbMock.blogPost.findUnique.mockResolvedValue(postRow({ status: 'pending', content: 'A real article', tags: ['Tactics'] }) as never)
    dbMock.blogPost.update.mockResolvedValue(postRow() as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/blog/1', headers: authHeaders(await accessToken()), payload: { seoTitle: 'Rondo for U10s' } })
    expect(res.statusCode).toBe(200)
    const data = dbMock.blogPost.update.mock.calls[0][0].data
    expect(data).toEqual({ seoTitle: 'Rondo for U10s' })
  })

  it('BLOG-PATCH-DEFAULTS: a coach renaming their article keeps its content and tags', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach', dateOfBirth: null } as never)
    dbMock.blogPost.findFirst.mockResolvedValue(postRow({ status: 'draft', authorKind: 'coach', content: 'A real article', tags: ['Tactics'] }) as never)
    dbMock.blogPost.update.mockResolvedValue(postRow() as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/articles/1', headers: authHeaders(await accessToken()), payload: { title: 'New title' } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.blogPost.update.mock.calls[0][0].data).toEqual({ title: 'New title' })
  })
})
