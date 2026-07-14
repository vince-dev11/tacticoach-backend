// Public share endpoints — published-only, no auth, owner-only writes intact.

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'

describe('GET /api/share/board/:id', () => {
  it('serves a published board without any auth', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue({
      id: 7, title: 'High press', publishedAt: new Date(),
      thumbnailKey: 'boards/1/7/t.webp', videoKey: 'boards/1/7/v.mp4',
      user: { name: 'Vince', surname: 'Coach', clubName: 'FC Test' },
      _count: { likes: 4 },
    } as never)

    const res = await app.inject({ method: 'GET', url: '/api/share/board/7' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.author).toBe('Vince Coach')
    expect(body.videoUrl).toContain('signed')
    expect(body.likeCount).toBe(4)
    // Published-only is enforced in the query itself
    expect(dbMock.canvasBoard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, published: true } }),
    )
  })

  it('404s unpublished/missing boards', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/share/board/99' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/share/sheet/:id', () => {
  it('serves a published sheet image + meta', async () => {
    const app = await getApp()
    dbMock.drillSheet.findFirst.mockResolvedValue({
      id: 3, title: 'U15 Pressing', description: 'Session plan', publishedAt: new Date(),
      imageKey: 'sheets/1/3.png',
      user: { name: 'Vince', surname: 'Coach', clubName: null },
    } as never)

    const res = await app.inject({ method: 'GET', url: '/api/share/sheet/3' })
    expect(res.statusCode).toBe(200)
    expect(res.json().imageUrl).toContain('signed')
  })

  it('404s unpublished sheets', async () => {
    const app = await getApp()
    dbMock.drillSheet.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/share/sheet/9' })
    expect(res.statusCode).toBe(404)
  })
})

describe('ownership still enforced on writes', () => {
  it('deleting someone else\'s board 404s (ownership in the query)', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(null) // not owned by user 1
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/canvas/boards/7',
      headers: authHeaders(await accessToken(1)),
    })
    expect(res.statusCode).toBe(404)
    expect(dbMock.canvasBoard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, userId: 1 } }),
    )
  })
})
