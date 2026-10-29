// NOTE-BOARD / PLAYER-ANSWER (29 Oct 2026): the move a coach sends with a note
// is watched privately by that player (or their parent) — the board is never
// published for it — and answered with a placed run or a tap, never words.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { moveForNote, answerNote } from '../src/modules/feedback/feedback.service.js'
import { noteAnswerOf, noteAnswerSchema } from '../src/lib/note-answer.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const state = {
  canvas: { tcMeta: { playerMessage: 'Go early, not when the ball arrives' } },
  objects: [{ type: 'player', props: { name: 'Jamie Smith', label: '8' } }, { type: 'football', props: {} }],
}

beforeEach(() => vi.clearAllMocks())

describe('moveForNote', () => {
  it('a player gets their own sent note’s board, names removed, main message kept, and "watched" is recorded once', async () => {
    mock.playerNote.findFirst.mockResolvedValue({
      id: 7, body: 'Your run when 10 turns', challenge: null, watchedAt: null, answer: null, answeredAt: null,
      board: { id: 36, title: 'Third-man run', state },
      coach: { name: 'Sam', surname: 'Coach' },
    })
    mock.playerNote.update.mockResolvedValue({})
    const move = await moveForNote({ playerUserId: 99 }, 7)
    expect(move).toBeTruthy()
    const where = mock.playerNote.findFirst.mock.calls[0][0].where
    // Only a SENT note with a board, belonging to this player's active link —
    // nothing about `published`: private boards travel with the note.
    expect(where).toMatchObject({ id: 7, sentAt: { not: null }, boardId: { not: null }, squadPlayer: { playerUserId: 99, linkStatus: 'active' } })
    expect(JSON.stringify(where)).not.toContain('published')
    expect(JSON.stringify(move!.board.state)).not.toContain('Jamie')
    expect(JSON.stringify(move!.board.state)).toContain('"label":"8"')
    expect(move!.message).toBe('Go early, not when the ball arrives')
    expect(move!.coach).toBe('Sam Coach')
    expect(mock.playerNote.update).toHaveBeenCalledTimes(1)
    expect(mock.playerNote.update.mock.calls[0][0].data.watchedAt).toBeInstanceOf(Date)
  })

  it('a second opening records nothing more', async () => {
    mock.playerNote.findFirst.mockResolvedValue({
      id: 7, body: '', challenge: null, watchedAt: new Date(), answer: null, answeredAt: null,
      board: { id: 36, title: 't', state }, coach: { name: 'S', surname: null },
    })
    await moveForNote({ playerUserId: 99 }, 7)
    expect(mock.playerNote.update).not.toHaveBeenCalled()
  })

  it('a parent reaches it only through an ACTIVE link to that child', async () => {
    mock.playerNote.findFirst.mockResolvedValue(null)
    expect(await moveForNote({ parentUserId: 5 }, 7)).toBeNull()
    const where = mock.playerNote.findFirst.mock.calls[0][0].where
    expect(where.squadPlayer).toEqual({ linkStatus: 'active', playerUser: { parentLinks: { some: { parentUserId: 5, status: 'active' } } } })
  })

  it('a stranger, an unsent note or a note without a board is a 404, never a 403 that confirms it exists', async () => {
    mock.playerNote.findFirst.mockResolvedValue(null)
    expect(await moveForNote({ playerUserId: 1 }, 7)).toBeNull()
  })
})

describe('answerNote', () => {
  it('stores a placed run once, and marks watched + read with it', async () => {
    mock.playerNote.updateMany.mockResolvedValue({ count: 1 })
    expect(await answerNote({ playerUserId: 99 }, 7, { kind: 'place', frame: 2, x: 812, y: 300 })).toBe(true)
    const { where, data } = mock.playerNote.updateMany.mock.calls[0][0]
    expect(where).toMatchObject({ id: 7, answeredAt: null, sentAt: { not: null }, boardId: { not: null } })
    expect(data.answer).toEqual({ kind: 'place', frame: 2, x: 812, y: 300 })
    expect(data.answeredAt).toBeInstanceOf(Date)
    expect(data.watchedAt).toBeInstanceOf(Date)
  })

  it('a second answer changes nothing', async () => {
    mock.playerNote.updateMany.mockResolvedValue({ count: 0 })
    expect(await answerNote({ playerUserId: 99 }, 7, { kind: 'choice', frame: 1, pick: 'b' })).toBe(false)
  })
})

describe('the answer shape', () => {
  it('is structured only — no words reach the coach', () => {
    expect(noteAnswerSchema.safeParse({ kind: 'text', text: 'hi coach' }).success).toBe(false)
    expect(noteAnswerSchema.safeParse({ kind: 'choice', frame: 1, pick: 'd' }).success).toBe(false)
    expect(noteAnswerSchema.safeParse({ kind: 'place', frame: 0, x: 1, y: 1 }).success).toBe(false)
    expect(noteAnswerOf({ kind: 'place', frame: 1, x: 10, y: 20 })).toEqual({ kind: 'place', frame: 1, x: 10, y: 20 })
    expect(noteAnswerOf('junk')).toBeNull()
  })
})
