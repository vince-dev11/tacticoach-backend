// SHEET-PRIVATE / SHEET-WATCH (12 Oct 2026) · a new drill sheet is private;
// a shared sheet's page carries its boards (names removed) to play — and
// never the rest of the sheet's data (the coach's private notes).
import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

// PUBLIC-DEFAULT (owner's decision, 17 Nov 2026) reversed SHEET-PRIVATE's
// default: a new sheet is shared unless the coach chose Private.
describe('PUBLIC-DEFAULT · a new drill sheet is shared unless the coach chose private', () => {
  it('POST /api/drill-sheets with published:false creates it private', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.drillSheet.create.mockResolvedValue({ id: 6, title: 'Rondo', published: false } as never)
    dbMock.drillSheet.create.mockClear()
    const res = await app.inject({
      method: 'POST', url: '/api/drill-sheets', headers: authHeaders(await accessToken()),
      payload: { title: 'Rondo', data: { meta: {} }, published: false },
    })
    expect(res.statusCode).toBe(201)
    const data = (dbMock.drillSheet.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.published).toBe(false)
    expect(data.publishedAt).toBeNull()
  })

  it('PATCH cannot publish: the choice after creation is /:id/publish only', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.drillSheet.findFirst.mockResolvedValue({ id: 5, userId: 1, published: false } as never)
    dbMock.drillSheet.update.mockResolvedValue({ id: 5 } as never)
    dbMock.drillSheet.update.mockClear()
    await app.inject({ method: 'PATCH', url: '/api/drill-sheets/5', headers: authHeaders(await accessToken()), payload: { title: 'Rondo 2', published: true } })
    const data = (dbMock.drillSheet.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).not.toHaveProperty('published')
  })

  it('POST /api/drill-sheets creates it shared when nothing is said', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.drillSheet.create.mockResolvedValue({ id: 5, title: 'Rondo', published: true } as never)
    dbMock.drillSheet.create.mockClear()
    const res = await app.inject({
      method: 'POST', url: '/api/drill-sheets', headers: authHeaders(await accessToken()),
      payload: { title: 'Rondo', data: { meta: {} } },
    })
    expect(res.statusCode).toBe(201)
    const data = (dbMock.drillSheet.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.published).toBe(true)
    expect(data.publishedAt).toBeInstanceOf(Date)
  })
})

describe('SHEET-WATCH · the shared page plays the boards, without names or notes', () => {
  it('returns the shown boards with player names removed, and no meta', async () => {
    const app = await getApp()
    const player = { tcType: 'player', tcProps: { name: 'Sam Smith', label: '7' } }
    dbMock.drillSheet.findFirst.mockResolvedValue({
      id: 3, userId: 1, title: 'Rondo', description: null, publishedAt: new Date(), imageKey: null,
      data: {
        meta: { reflection: 'Too big for U9s', keyPoint: 'x' },
        layout: 1,
        boards: [{ canvas: { objects: [player] }, frames: [] }, { canvas: { objects: [player] }, frames: [] }],
        captions: ['Set-up', 'Hidden'],
      },
      user: { name: 'Vince', surname: 'Coach', clubName: null },
    } as never)
    const res = await app.inject({ method: 'GET', url: '/api/share/sheet/3' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.boards).toHaveLength(1)
    expect(body.boards[0].caption).toBe('Set-up')
    expect(JSON.stringify(body)).not.toContain('Sam Smith')
    expect(JSON.stringify(body)).not.toContain('Too big for U9s')
    expect(body.boards[0].board.canvas.objects[0].tcProps.label).toBe('7')
  })
})
