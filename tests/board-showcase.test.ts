// SHOWCASE (25 Nov 2026) · the sessions on the public website's "Press play on
// a real session": picked by the owner, only while public, light to load.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'

beforeEach(() => {
  dbMock.canvasBoard.findMany.mockReset()
})

describe('SHOWCASE · public list', () => {
  it('only published boards with a place, in order, at most six — and no board data', async () => {
    dbMock.canvasBoard.findMany.mockResolvedValue([
      { id: 12, title: '4v2 rondo', thumbnailKey: null, ageGroup: 'u11', tags: ['rondo', 3], hasAnimation: true, user: { name: 'Sam', surname: 'Coach', clubName: 'Riverside' } },
    ] as never)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/share/showcase' })
    expect(res.statusCode).toBe(200)
    const args = dbMock.canvasBoard.findMany.mock.calls[0][0] as { where: unknown; orderBy: unknown; take: number; select: Record<string, unknown> }
    expect(args.where).toEqual({ showcaseRank: { not: null }, published: true })
    expect(args.orderBy).toEqual({ showcaseRank: 'asc' })
    expect(args.take).toBe(6)
    expect(args.select.state).toBeUndefined()
    expect(res.json().sessions[0]).toEqual({ id: 12, title: '4v2 rondo', ageGroup: 'u11', tags: ['rondo'], animated: true, author: 'Sam Coach', clubName: 'Riverside', thumbnailUrl: null })
    expect(res.headers['cache-control']).toContain('max-age=300')
  })
})

describe('SHOWCASE · the owner picks', () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    dbMock.$transaction.mockResolvedValue([] as never)
  })

  it('a normal account cannot', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'PUT', url: '/api/admin/showcase', headers: authHeaders(await accessToken(5)), payload: { boardIds: [1] } })
    expect(res.statusCode).toBe(403)
  })

  it('a private board can never go on the website', async () => {
    dbMock.canvasBoard.findMany.mockResolvedValue([{ id: 7, published: false }] as never)
    const app = await getApp()
    const res = await app.inject({ method: 'PUT', url: '/api/admin/showcase', headers: authHeaders(await accessToken(1)), payload: { boardIds: [7] } })
    expect(res.statusCode).toBe(409)
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it('more than six, or the same board twice, is refused', async () => {
    const app = await getApp()
    const h = authHeaders(await accessToken(1))
    expect((await app.inject({ method: 'PUT', url: '/api/admin/showcase', headers: h, payload: { boardIds: [1, 2, 3, 4, 5, 6, 7] } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/showcase', headers: h, payload: { boardIds: [1, 1] } })).statusCode).toBe(422)
  })

  it('saves the order: 1, 2, 3 …', async () => {
    dbMock.canvasBoard.findMany.mockResolvedValue([{ id: 7, published: true }, { id: 3, published: true }] as never)
    const app = await getApp()
    const res = await app.inject({ method: 'PUT', url: '/api/admin/showcase', headers: authHeaders(await accessToken(1)), payload: { boardIds: [7, 3] } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.canvasBoard.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { showcaseRank: 1 } })
    expect(dbMock.canvasBoard.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { showcaseRank: 2 } })
    expect(dbMock.canvasBoard.updateMany).toHaveBeenCalledWith({ where: { showcaseRank: { not: null }, id: { notIn: [7, 3] } }, data: { showcaseRank: null } })
  })
})

describe('SHOWCASE · migration 70', () => {
  it('only adds a nullable column and its index', () => {
    const sql = readFileSync('prisma/migrations/70_board_showcase/migration.sql', 'utf8')
    expect(sql).toMatch(/ADD COLUMN `showcase_rank` INT NULL/)
    expect(sql).not.toMatch(/\bDROP\b|DELETE FROM|^UPDATE |TRUNCATE/im)
  })
})
