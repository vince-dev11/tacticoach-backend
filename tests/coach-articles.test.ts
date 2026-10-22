// COACH-ARTICLES (20 Oct 2026): coaches write articles, admins approve them,
// nothing is public until then, and only the admin sets SEO keywords.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { readFileSync } from 'node:fs'

function callerIs(accountType: 'coach' | 'player' | 'parent', role = 'user') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role, accountType } as never)
    return Promise.resolve({ id: 1, name: 'Ana', surname: 'Coach', email: 'ana@test.dev', coachSlug: 'ana', role, accountType } as never)
  })
}

const article = (o: Record<string, unknown> = {}) => ({
  id: 7, slug: 'my-rondo', title: 'My rondo', excerpt: null, content: 'x'.repeat(300), coverImageKey: null, tags: [],
  status: 'draft', publishedAt: null, authorId: 1, authorKind: 'coach', seoTitle: null, seoDescription: null, seoKeywords: null,
  readMinutes: 2, submittedAt: null, reviewedAt: null, reviewNote: null, createdAt: new Date(), updatedAt: new Date(), ...o,
})

beforeEach(() => vi.clearAllMocks())

describe('COACH-ARTICLES · migration and schema', () => {
  it('55_coach_articles adds the review states, the author kind and the keywords', () => {
    const sql = readFileSync('prisma/migrations/55_coach_articles/migration.sql', 'utf8')
    expect(sql).toContain("ENUM('draft', 'pending', 'changes_requested', 'rejected', 'published')")
    expect(sql).toContain('`author_kind`')
    expect(sql).toContain('`seo_keywords`')
    expect(sql).toContain('`review_note`')
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).toMatch(/enum PostStatus \{\s+draft\s+pending\s+changes_requested\s+rejected\s+published\s+\}/)
  })
})

describe('COACH-ARTICLES · a coach writes and submits', () => {
  it('creates a draft of kind coach, with a slug from the title; no slug or SEO from the coach', async () => {
    const app = await getApp()
    callerIs('coach')
    dbMock.blogPost.findFirst.mockResolvedValue(null)
    dbMock.blogPost.create.mockResolvedValue(article() as never)
    const res = await app.inject({
      method: 'POST', url: '/api/articles', headers: authHeaders(await accessToken()),
      payload: { title: 'My rondo', content: 'x'.repeat(300), slug: 'hacked', seoTitle: 'SEO', seoKeywords: ['k'] },
    })
    expect(res.statusCode).toBe(201)
    const data = dbMock.blogPost.create.mock.calls[0][0].data as Record<string, unknown>
    expect(data.authorKind).toBe('coach')
    expect(data.status).toBe('draft')
    expect(data.slug).toBe('my-rondo')
    expect(data.seoTitle).toBeUndefined()
    expect(data.seoKeywords).toBeUndefined()
  })

  it('submit needs a title and some content, then goes pending', async () => {
    const app = await getApp()
    callerIs('coach')
    dbMock.blogPost.findFirst.mockResolvedValue(article({ content: 'short' }) as never)
    const thin = await app.inject({ method: 'POST', url: '/api/articles/7/submit', headers: authHeaders(await accessToken()) })
    expect(thin.statusCode).toBe(422)

    dbMock.blogPost.findFirst.mockResolvedValue(article() as never)
    dbMock.blogPost.update.mockResolvedValue(article({ status: 'pending' }) as never)
    const ok = await app.inject({ method: 'POST', url: '/api/articles/7/submit', headers: authHeaders(await accessToken()) })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().status).toBe('pending')
    expect(dbMock.blogPost.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', reviewNote: null })
  })

  it('editing a published article sends it back to review', async () => {
    const app = await getApp()
    callerIs('coach')
    dbMock.blogPost.findFirst.mockResolvedValue(article({ status: 'published', publishedAt: new Date() }) as never)
    dbMock.blogPost.update.mockResolvedValue(article({ status: 'pending' }) as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/articles/7', headers: authHeaders(await accessToken()), payload: { title: 'My rondo, improved' } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.blogPost.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', title: 'My rondo, improved' })
  })

  it('only my own articles: somebody else’s id is a 404; a live one cannot be deleted', async () => {
    const app = await getApp()
    callerIs('coach')
    dbMock.blogPost.findFirst.mockResolvedValue(null)
    const other = await app.inject({ method: 'GET', url: '/api/articles/mine/99', headers: authHeaders(await accessToken()) })
    expect(other.statusCode).toBe(404)
    expect(dbMock.blogPost.findFirst.mock.calls[0][0].where).toMatchObject({ authorId: 1, authorKind: 'coach' })

    dbMock.blogPost.findFirst.mockResolvedValue({ coverImageKey: null, status: 'published' } as never)
    const del = await app.inject({ method: 'DELETE', url: '/api/articles/7', headers: authHeaders(await accessToken()) })
    expect(del.statusCode).toBe(409)
    expect(dbMock.blogPost.delete).not.toHaveBeenCalled()
  })

  it('players and parents never reach the article routes', async () => {
    const app = await getApp()
    for (const kind of ['player', 'parent'] as const) {
      callerIs(kind)
      const res = await app.inject({ method: 'GET', url: '/api/articles/mine', headers: authHeaders(await accessToken()) })
      expect(res.statusCode, kind).toBe(403)
    }
  })
})

describe('COACH-ARTICLES · the admin reviews', () => {
  it('approve publishes with the keywords and emails the coach; non-owners cannot', async () => {
    const app = await getApp()
    callerIs('coach', 'user')
    const forbidden = await app.inject({ method: 'PATCH', url: '/api/admin/blog/7/review', headers: authHeaders(await accessToken()), payload: { action: 'approve' } })
    expect(forbidden.statusCode).toBe(403)

    callerIs('coach', 'owner')
    dbMock.blogPost.findUnique.mockResolvedValue(article({ status: 'pending' }) as never)
    dbMock.blogPost.update.mockResolvedValue(article({ status: 'published', publishedAt: new Date() }) as never)
    const res = await app.inject({
      method: 'PATCH', url: '/api/admin/blog/7/review', headers: authHeaders(await accessToken()),
      payload: { action: 'approve', seoKeywords: ['rondo', 'possession drills'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('published')
    const data = dbMock.blogPost.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data.status).toBe('published')
    expect(data.seoKeywords).toEqual(['rondo', 'possession drills'])
    expect(data.publishedAt).toBeInstanceOf(Date)
  })

  it('send back and reject need a note; the note is kept for the coach', async () => {
    const app = await getApp()
    callerIs('coach', 'owner')
    dbMock.blogPost.findUnique.mockResolvedValue(article({ status: 'pending' }) as never)
    const noNote = await app.inject({ method: 'PATCH', url: '/api/admin/blog/7/review', headers: authHeaders(await accessToken()), payload: { action: 'changes' } })
    expect(noNote.statusCode).toBe(422)

    dbMock.blogPost.update.mockResolvedValue(article({ status: 'changes_requested', reviewNote: 'Add the coaching points' }) as never)
    const ok = await app.inject({ method: 'PATCH', url: '/api/admin/blog/7/review', headers: authHeaders(await accessToken()), payload: { action: 'changes', note: 'Add the coaching points' } })
    expect(ok.statusCode).toBe(200)
    expect(dbMock.blogPost.update.mock.calls[0][0].data).toMatchObject({ status: 'changes_requested', reviewNote: 'Add the coaching points' })
  })

  it('the admin editor can set keywords on any post', async () => {
    const app = await getApp()
    callerIs('coach', 'owner')
    dbMock.blogPost.findUnique.mockResolvedValue(article({ authorKind: 'team' }) as never)
    dbMock.blogPost.findFirst.mockResolvedValue(null)
    dbMock.blogPost.update.mockResolvedValue(article({ authorKind: 'team', seoKeywords: ['a'] }) as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/blog/7', headers: authHeaders(await accessToken()), payload: { seoKeywords: ['a', 'b'] } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.blogPost.update.mock.calls[0][0].data).toMatchObject({ seoKeywords: ['a', 'b'] })
  })
})

describe('COACH-ARTICLES · the public blog', () => {
  it('shows only published posts, with a byline for a coach article and none for a team post', async () => {
    const app = await getApp()
    dbMock.blogPost.findMany.mockResolvedValue([
      article({ id: 1, status: 'published', publishedAt: new Date(), authorKind: 'coach', authorId: 1 }),
      article({ id: 2, slug: 'team-post', status: 'published', publishedAt: new Date(), authorKind: 'team', authorId: 9 }),
    ] as never)
    dbMock.blogPost.count.mockResolvedValue(2 as never)
    dbMock.user.findMany.mockResolvedValue([{ id: 1, name: 'Ana', surname: 'Silva', coachSlug: 'ana' }] as never)
    const res = await app.inject({ method: 'GET', url: '/api/blog' })
    expect(res.statusCode).toBe(200)
    const [coach, team] = res.json().posts
    expect(coach.author).toEqual({ name: 'Ana Silva', coachSlug: 'ana' })
    expect(team.author).toBeNull()
    expect(coach.authorId).toBeUndefined()
    expect(dbMock.blogPost.findMany.mock.calls[0][0].where).toEqual({ status: 'published' })
  })

  it('a single post carries the keywords and byline, never the review note', async () => {
    const app = await getApp()
    dbMock.blogPost.findFirst.mockResolvedValue(article({ status: 'published', seoKeywords: ['rondo'], reviewNote: 'internal', authorKind: 'coach' }) as never)
    dbMock.user.findMany.mockResolvedValue([{ id: 1, name: 'Ana', surname: null, coachSlug: null }] as never)
    const res = await app.inject({ method: 'GET', url: '/api/blog/my-rondo' })
    expect(res.statusCode).toBe(200)
    expect(res.json().seoKeywords).toEqual(['rondo'])
    expect(res.json().author).toEqual({ name: 'Ana', coachSlug: null })
    expect(res.json().reviewNote).toBeUndefined()
  })
})
