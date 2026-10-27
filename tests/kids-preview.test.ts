// KIDS-F2 (26 Oct 2026) — the parents' "before the session" preview: a private
// link the coach turns on and off; the public page shows practices, the one
// line to remember and the question — never names, notes or coaching points.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import { previewPractices, boardPlayerMessage } from '../src/modules/share/share.routes.js'

const player = (name: string) => ({ tcType: 'player', tcProps: { name, number: '7' } })
const board = (message?: string) => ({
  canvas: { version: '1', objects: [player('Amelia Jones')], ...(message ? { tcMeta: { playerMessage: message } } : {}) },
  frames: [],
})

describe('KIDS-F2 · migration 60', () => {
  it('adds the preview token (unique), the question and the note challenge — all nullable', () => {
    const sql = readFileSync('prisma/migrations/60_kids_understand/migration.sql', 'utf8')
    expect(sql).toContain('ADD COLUMN `preview_token` VARCHAR(32) NULL')
    expect(sql).toContain('ADD COLUMN `preview_question` VARCHAR(200) NULL')
    expect(sql).toContain('CREATE UNIQUE INDEX `training_sessions_preview_token_key`')
    expect(sql).toContain('ALTER TABLE `player_notes` ADD COLUMN `challenge` VARCHAR(200) NULL')
  })
})

describe('KIDS-F2 · what the preview shows', () => {
  it('per practice: title, minutes, message (own → sheet → board) and the board with names removed; notes left out', async () => {
    dbMock.canvasBoard.findMany.mockResolvedValue([{ id: 4, state: board('Eyes up') }] as never)
    dbMock.drillSheet.findMany.mockResolvedValue([{ id: 9, data: { meta: { keyPoint: 'Find the free player' }, boards: [board()], layout: 1 } }] as never)
    const out = await previewPractices(1, [
      { kind: 'text', title: 'Drinks', minutes: 2 },
      { kind: 'drill', title: 'Rondo', minutes: 10, keyPoint: 'Pass and move', board: board('ignored'), coachingPoints: 'secret' },
      { kind: 'board', refId: 4, title: 'Press', minutes: 15 },
      { kind: 'sheet', refId: 9, title: '4v2', minutes: 12 },
    ])
    expect(out.map((p) => [p.title, p.minutes, p.message])).toEqual([
      ['Rondo', 10, 'Pass and move'],
      ['Press', 15, 'Eyes up'],
      ['4v2', 12, 'Find the free player'],
    ])
    expect(JSON.stringify(out)).not.toContain('Amelia')
    expect(JSON.stringify(out)).not.toContain('secret')
    // Only the session owner's own boards and sheets are ever read.
    expect(dbMock.canvasBoard.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [4] }, userId: 1 } }))
    expect(dbMock.drillSheet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [9] }, userId: 1 } }))
    expect(boardPlayerMessage(board(' Head up '))).toBe('Head up')
  })

  it('GET /share/session/:token — a bad or switched-off token is 404; a live one returns the preview', async () => {
    const app = await getApp()
    expect((await app.inject({ method: 'GET', url: '/api/share/session/x' })).statusCode).toBe(404)
    dbMock.trainingSession.findFirst.mockResolvedValueOnce(null)
    expect((await app.inject({ method: 'GET', url: '/api/share/session/abcdefghijklmnopqrstuv' })).statusCode).toBe(404)

    dbMock.trainingSession.findFirst.mockResolvedValueOnce({
      userId: 1, title: 'Tuesday', description: 'Playing out from the back', sessionDate: null, previewQuestion: 'Where do you stand when our keeper has it?',
      blocks: [{ kind: 'drill', title: 'Rondo', minutes: 10, keyPoint: 'Pass and move', board: board() }],
      user: { name: 'Sam', surname: 'Coach', clubName: 'FC Test' },
    } as never)
    dbMock.user.findUnique.mockResolvedValue({ ownedClub: null, clubMembership: null } as never)
    const res = await app.inject({ method: 'GET', url: '/api/share/session/abcdefghijklmnopqrstuv' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ title: 'Tuesday', aim: 'Playing out from the back', question: 'Where do you stand when our keeper has it?', coach: 'Sam Coach' })
    expect(body.practices).toHaveLength(1)
    expect(Object.keys(body)).not.toContain('squadId')
    expect(JSON.stringify(body)).not.toContain('Amelia')
  })
})

describe('KIDS-F2 · the coach turns the link on and off', () => {
  it('POST makes a token once and keeps it; DELETE clears it; someone else’s session is 404', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.trainingSession.findFirst.mockResolvedValueOnce({ id: 3, previewToken: null } as never)
    dbMock.trainingSession.update.mockImplementationOnce((async (args: { data: { previewToken: string; previewQuestion?: string } }) => ({ previewToken: args.data.previewToken, previewQuestion: args.data.previewQuestion ?? null })) as never)
    const on = await app.inject({ method: 'POST', url: '/api/sessions/3/preview', headers: authHeaders(await accessToken()), payload: { question: 'Who is free?' } })
    expect(on.statusCode).toBe(200)
    expect(on.json().previewToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(on.json().previewQuestion).toBe('Who is free?')

    dbMock.trainingSession.findFirst.mockResolvedValueOnce({ id: 3, previewToken: 'keepthesametoken123456' } as never)
    dbMock.trainingSession.update.mockImplementationOnce((async (args: { data: { previewToken: string } }) => ({ previewToken: args.data.previewToken, previewQuestion: null })) as never)
    const again = await app.inject({ method: 'POST', url: '/api/sessions/3/preview', headers: authHeaders(await accessToken()), payload: {} })
    expect(again.json().previewToken).toBe('keepthesametoken123456')

    dbMock.trainingSession.findFirst.mockResolvedValueOnce({ id: 3 } as never)
    dbMock.trainingSession.update.mockResolvedValueOnce({} as never)
    const off = await app.inject({ method: 'DELETE', url: '/api/sessions/3/preview', headers: authHeaders(await accessToken()) })
    expect(off.json()).toEqual({ previewToken: null })
    expect(dbMock.trainingSession.update).toHaveBeenLastCalledWith({ where: { id: 3 }, data: { previewToken: null } })

    dbMock.trainingSession.findFirst.mockResolvedValueOnce(null)
    const notMine = await app.inject({ method: 'DELETE', url: '/api/sessions/99/preview', headers: authHeaders(await accessToken()) })
    expect(notMine.statusCode).toBe(404)
  })
})
