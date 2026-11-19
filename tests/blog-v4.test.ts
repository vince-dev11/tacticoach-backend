// BLOG-V4 (19 Nov 2026, owner approved the blog design): an article's age
// label, formats and practice box, and the blog page's topic / format / search
// filters applied by the API (so paging stays right).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { blogFilters } from '../src/modules/blog/blog.routes.js'

function owner() {
  dbMock.user.findUnique.mockImplementation((() => Promise.resolve({ role: 'owner', accountType: 'coach' } as never)) as never)
}
const row = (o: Record<string, unknown> = {}) => ({
  id: 1, slug: 'rondo', title: 'Rondo', excerpt: null, content: 'x', coverImageKey: null, tags: [], status: 'draft',
  publishedAt: null, authorId: 1, authorKind: 'team', seoTitle: null, seoDescription: null, readMinutes: 1,
  createdAt: new Date(), updatedAt: new Date(), ...o,
})

describe('BLOG-V4 · filters', () => {
  it('no filter is exactly the published posts (unchanged)', () => {
    expect(blogFilters({})).toEqual({ status: 'published' })
  })
  it('topic, format and search narrow the list; unknown values are ignored', () => {
    expect(blogFilters({ tag: 'Tactics', format: '7v7', q: ' rondo ' })).toEqual({
      status: 'published',
      AND: [
        { tags: { array_contains: ['Tactics'] } },
        { formats: { array_contains: ['7v7'] } },
        { OR: [{ title: { contains: 'rondo' } }, { excerpt: { contains: 'rondo' } }] },
      ],
    })
    expect(blogFilters({ format: '6v6', tag: '', q: '   ' })).toEqual({ status: 'published' })
  })
  it('GET /api/blog pages with the same filter it counts with', async () => {
    const app = await getApp()
    dbMock.blogPost.findMany.mockResolvedValue([] as never)
    dbMock.blogPost.count.mockResolvedValue(0 as never)
    const res = await app.inject({ method: 'GET', url: '/api/blog?format=9v9' })
    expect(res.statusCode).toBe(200)
    const where = { status: 'published', AND: [{ formats: { array_contains: ['9v9'] } }] }
    expect(dbMock.blogPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }))
    expect(dbMock.blogPost.count).toHaveBeenCalledWith({ where })
  })
})

describe('BLOG-V4 · admin saves the details', () => {
  it('stores age, formats and a trimmed practice box; an empty box is no box', async () => {
    const app = await getApp()
    owner()
    dbMock.blogPost.findFirst.mockResolvedValue(null)
    dbMock.blogPost.create.mockResolvedValue(row() as never)
    const res = await app.inject({
      method: 'POST', url: '/api/admin/blog', headers: authHeaders(await accessToken()),
      payload: { title: 'Rondo', content: 'x', ageGroup: 'U9–U11', formats: ['5v5', '7v7'],
        practice: { players: '4 + 1', area: '10 × 10 m', time: '', equipment: '4 cones' } },
    })
    expect(res.statusCode).toBe(201)
    const data = dbMock.blogPost.create.mock.calls[0][0].data
    expect(data.ageGroup).toBe('U9–U11')
    expect(data.formats).toEqual(['5v5', '7v7'])
    expect(data.practice).toEqual({ players: '4 + 1', area: '10 × 10 m', equipment: '4 cones' })

    dbMock.blogPost.findUnique.mockResolvedValue(row() as never)
    dbMock.blogPost.update.mockResolvedValue(row() as never)
    await app.inject({
      method: 'PATCH', url: '/api/admin/blog/1', headers: authHeaders(await accessToken()),
      payload: { practice: { players: ' ', area: '' }, formats: [] },
    })
    const upd = dbMock.blogPost.update.mock.calls[0][0].data
    expect(upd.practice).toBe(Prisma.DbNull)
    expect(upd.formats).toBe(Prisma.DbNull)
  })
  it('refuses a format that is not one of ours', async () => {
    const app = await getApp()
    owner()
    const res = await app.inject({
      method: 'POST', url: '/api/admin/blog', headers: authHeaders(await accessToken()),
      payload: { title: 'x', formats: ['6v6'] },
    })
    expect(res.statusCode).toBe(422)
  })
  it('the migration adds the three nullable columns', () => {
    const sql = readFileSync('prisma/migrations/67_blog_practice/migration.sql', 'utf8')
    for (const c of ['`age_group` VARCHAR(40) NULL', '`formats` JSON NULL', '`practice` JSON NULL']) expect(sql).toContain(c)
  })
})
