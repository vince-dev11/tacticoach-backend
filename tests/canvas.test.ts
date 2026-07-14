import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

function boardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    userId: 1,
    title: 'High press 4-3-3',
    pitchKey: 'full',
    state: {},
    thumbnailKey: null,
    videoKey: null,
    thumbnailUrl: null,
    published: true,
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Grant editor access to user 1 (active sub, no club). */
function grantEditorAccess() {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

/** No sub, no club → no editor access. */
function revokeEditorAccess() {
  dbMock.userSubscription.findUnique.mockResolvedValue(null)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

describe('auth gating', () => {
  it('rejects unauthenticated access to /api/canvas/boards', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/canvas/boards' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/canvas/boards', () => {
  it('lists the current user boards with pagination and presigned media', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([
      boardRow({ thumbnailKey: 'boards/1/10/thumb.webp', _count: { likes: 3 } }),
    ] as never)
    dbMock.canvasBoard.count.mockResolvedValue(1 as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/boards?page=1&limit=20',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(1)
    expect(body.boards[0].thumbnailUrl).toContain('signed')
  })
})

describe('POST /api/canvas/boards', () => {
  it('blocks users without editor access (expired trial) with 403 NO_EDITOR_ACCESS', async () => {
    const app = await getApp()
    revokeEditorAccess()

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/boards',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Blocked board' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NO_EDITOR_ACCESS')
  })

  it('creates a board (public by default) for an entitled user', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.canvasBoard.create.mockResolvedValue(boardRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/boards',
      headers: authHeaders(await accessToken()),
      payload: { title: 'High press 4-3-3', pitchKey: 'full' },
    })
    expect(res.statusCode).toBe(201)
    expect(dbMock.canvasBoard.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ published: true }) }),
    )
  })
})

describe('GET /api/canvas/boards/:id', () => {
  it('404s for a private board owned by someone else', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/boards/99',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
    // Ownership/visibility enforced in the query itself
    expect(dbMock.canvasBoard.findFirst).toHaveBeenCalledWith({
      where: { id: 99, OR: [{ userId: 1 }, { published: true }] },
    })
  })
})

describe('PATCH /api/canvas/boards/:id', () => {
  it('404s when updating a board the user does not own', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.canvasBoard.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/canvas/boards/42',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Hijacked' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('updates own board', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.canvasBoard.findFirst.mockResolvedValue(boardRow() as never)
    dbMock.canvasBoard.update.mockResolvedValue(boardRow({ title: 'Renamed' }) as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/canvas/boards/10',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Renamed' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().title).toBe('Renamed')
  })
})

describe('PATCH /api/canvas/boards/:id/publish', () => {
  it('toggles visibility and stamps publishedAt', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(boardRow({ published: false, publishedAt: null }) as never)
    dbMock.canvasBoard.update.mockResolvedValue(boardRow({ published: true }) as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/canvas/boards/10/publish',
      headers: authHeaders(await accessToken()),
      payload: { published: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().published).toBe(true)
    const call = dbMock.canvasBoard.update.mock.calls[0][0]
    expect(call.data.published).toBe(true)
    expect(call.data.publishedAt).toBeInstanceOf(Date)
  })

  it('validates the payload (422 on non-boolean)', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/canvas/boards/10/publish',
      headers: authHeaders(await accessToken()),
      payload: { published: 'yes' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('board likes', () => {
  it('likes a published board idempotently (upsert) and returns the count', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(boardRow() as never)
    dbMock.boardLike.upsert.mockResolvedValue({} as never)
    dbMock.boardLike.count.mockResolvedValue(4 as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/boards/10/like',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ liked: true, likeCount: 4 })
  })

  it('cannot like an unpublished board (404)', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/boards/10/like',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
  })

  it('unlikes and returns the fresh count', async () => {
    const app = await getApp()
    dbMock.boardLike.deleteMany.mockResolvedValue({ count: 1 } as never)
    dbMock.boardLike.count.mockResolvedValue(3 as never)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/canvas/boards/10/like',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ liked: false, likeCount: 3 })
  })
})

describe('GET /api/canvas/library', () => {
  it('returns only published boards with likedByMe flags', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findMany.mockResolvedValue([
      boardRow({
        user: { id: 2, name: 'Other', surname: 'Coach', clubName: null },
        _count: { likes: 2 },
        likes: [{ id: 1 }],
      }),
    ] as never)
    dbMock.canvasBoard.count.mockResolvedValue(1 as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/library',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.boards[0].likedByMe).toBe(true)
    expect(body.boards[0].likeCount).toBe(2)
    expect(dbMock.canvasBoard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: true } }),
    )
  })
})

describe('DELETE /api/canvas/boards/:id', () => {
  it('deletes own board and its S3 media', async () => {
    const app = await getApp()
    const { deleteFromS3 } = await import('../src/config/s3.js')
    dbMock.canvasBoard.findFirst.mockResolvedValue(
      boardRow({ thumbnailKey: 'boards/1/10/t.webp', videoKey: 'boards/1/10/v.mp4' }) as never,
    )
    dbMock.canvasBoard.delete.mockResolvedValue(boardRow() as never)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/canvas/boards/10',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(204)
    expect(deleteFromS3).toHaveBeenCalledWith('boards/1/10/t.webp')
    expect(deleteFromS3).toHaveBeenCalledWith('boards/1/10/v.mp4')
  })
})
