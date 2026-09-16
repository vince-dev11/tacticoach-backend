// Player feedback: linking, writing and reading.
//
// The rules worth breaking a build over:
//   - a coach knowing an email address cannot start writing to a child
//   - editing a squad must never destroy a player's feedback history
//   - a note stops being editable once it is sent, or after 30 minutes

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import {
  noteIsEditable,
  NOTE_EDIT_WINDOW_MS,
  requestLink,
  answerLink,
  playerAccountExists,
  writeNote,
} from '../src/modules/feedback/feedback.service.js'
import { saveSquad } from '../src/modules/users/users.service.js'

// Typed once prisma generate has run against the new schema; the deep mock
// creates these at runtime regardless.
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('noteIsEditable', () => {
  const now = new Date('2026-09-16T20:00:00Z')

  it('is editable straight after writing — typos happen', () => {
    expect(noteIsEditable({ createdAt: new Date(now.getTime() - 60_000), sentAt: null }, now)).toBe(true)
  })

  it('freezes after the window, so nobody rewrites history', () => {
    const old = new Date(now.getTime() - NOTE_EDIT_WINDOW_MS - 1)
    expect(noteIsEditable({ createdAt: old, sentAt: null }, now)).toBe(false)
  })

  it('freezes immediately once sent, however recent', () => {
    // A parent may already have read it.
    expect(noteIsEditable({ createdAt: now, sentAt: now }, now)).toBe(false)
  })

  it('gives a coach long enough to soften something written after a bad result', () => {
    expect(NOTE_EDIT_WINDOW_MS).toBeGreaterThanOrEqual(15 * 60 * 1000)
    expect(NOTE_EDIT_WINDOW_MS).toBeLessThanOrEqual(60 * 60 * 1000)
  })
})

describe('playerAccountExists', () => {
  it('only ever matches a player account', async () => {
    mock.user.findFirst.mockResolvedValue(null)
    await playerAccountExists('Coach@Example.com ')
    // Lower-cased and trimmed, and scoped to accountType — a coach's email
    // must not report as a linkable player.
    expect(mock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'coach@example.com', accountType: 'player' },
      }),
    )
  })
})

describe('requestLink', () => {
  it('leaves the link PENDING — a coach knowing an email is not consent', async () => {
    mock.squadPlayer.findFirst
      .mockResolvedValueOnce({ id: 5, playerUserId: null }) // the coach's row
      .mockResolvedValueOnce(null) // no clash elsewhere in this squad
    mock.user.findFirst.mockResolvedValue({ id: 99 })
    mock.squadPlayer.update.mockResolvedValue({})

    expect(await requestLink(1, 5, 'p@example.com')).toEqual({ ok: true })
    expect(mock.squadPlayer.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { playerUserId: 99, linkStatus: 'pending', linkedAt: null },
    })
  })

  it('refuses a row belonging to another coach', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue(null)
    expect(await requestLink(1, 5, 'p@example.com')).toEqual({ ok: false, reason: 'not_yours' })
    expect(mock.squadPlayer.update).not.toHaveBeenCalled()
  })

  it('says so when the email has no player account', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5, playerUserId: null })
    mock.user.findFirst.mockResolvedValue(null)
    expect(await requestLink(1, 5, 'nobody@example.com')).toEqual({ ok: false, reason: 'no_account' })
  })

  it('refuses the same player twice in one squad', async () => {
    mock.squadPlayer.findFirst
      .mockResolvedValueOnce({ id: 5, playerUserId: null })
      .mockResolvedValueOnce({ id: 6 }) // already on another row
    mock.user.findFirst.mockResolvedValue({ id: 99 })
    expect(await requestLink(1, 5, 'p@example.com')).toEqual({ ok: false, reason: 'in_another_row' })
  })
})

describe('answerLink', () => {
  it('activates on accept', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.squadPlayer.update.mockResolvedValue({})
    expect(await answerLink(99, 5, true)).toBe(true)
    expect(mock.squadPlayer.update.mock.calls[0][0].data).toMatchObject({ linkStatus: 'active' })
  })

  it('clears the link entirely on decline — no trace of the request', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.squadPlayer.update.mockResolvedValue({})
    await answerLink(99, 5, false)
    expect(mock.squadPlayer.update.mock.calls[0][0].data).toEqual({
      playerUserId: null,
      linkStatus: null,
      linkedAt: null,
    })
  })

  it('only the player themselves can answer', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue(null)
    expect(await answerLink(1234, 5, true)).toBe(false)
  })
})

describe('writeNote', () => {
  it('refuses to write about a player who is not on this coach\'s roster', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue(null)
    expect(await writeNote(1, 7, { squadPlayerId: 5, body: 'x', strengths: [], workOns: [] })).toBeNull()
  })

  it('will not change a note that has already been sent', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue({
      id: 3,
      createdAt: new Date(),
      sentAt: new Date(),
    })
    const result = await writeNote(1, 7, { squadPlayerId: 5, body: 'new', strengths: [], workOns: [] })
    expect(result).toEqual({ locked: true })
    expect(mock.playerNote.update).not.toHaveBeenCalled()
  })

  it('strips a tag that appears in both lists before storing', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue(null)
    mock.playerNote.create.mockResolvedValue({ id: 1 })

    await writeNote(1, 7, {
      squadPlayerId: 5,
      body: '  keep the shape  ',
      strengths: ['scanning'],
      workOns: ['scanning', 'weak_foot'],
    })

    const { data } = mock.playerNote.create.mock.calls[0][0]
    expect(data.strengths).toEqual(['scanning'])
    expect(data.workOns).toEqual(['weak_foot'])
    expect(data.body).toBe('keep the shape')
  })
})

describe('saveSquad — the destructive-save regression', () => {
  // This used to be deleteMany + createMany. Harmless while a row held a name,
  // a number and a position; catastrophic once it owns a player's account link
  // and every note their coach has written them. A coach fixing a shirt number
  // must not wipe a child's season.
  it('never deletes the whole squad', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([
      { id: 1, playerUserId: 99, _count: { notes: 4 } },
    ])
    mock.$transaction.mockResolvedValue([])

    await saveSquad(7, [{ id: 1, name: 'Marco', number: '7', position: 'MF' }])

    expect(mock.squadPlayer.deleteMany).not.toHaveBeenCalled()
    expect(mock.squadPlayer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: 'Marco', number: '7', position: 'MF', sortOrder: 0 },
    })
  })

  it('archives a dropped player who has notes, rather than deleting them', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([
      { id: 1, playerUserId: null, _count: { notes: 3 } },
    ])
    mock.$transaction.mockResolvedValue([])

    await saveSquad(7, []) // coach removed everyone

    expect(mock.squadPlayer.delete).not.toHaveBeenCalled()
    expect(mock.squadPlayer.update.mock.calls[0][0].data).toMatchObject({ archivedAt: expect.any(Date) })
  })

  it('archives a dropped player who is linked, even with no notes yet', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([
      { id: 1, playerUserId: 99, _count: { notes: 0 } },
    ])
    mock.$transaction.mockResolvedValue([])
    await saveSquad(7, [])
    expect(mock.squadPlayer.delete).not.toHaveBeenCalled()
  })

  it('deletes a dropped player with nothing worth keeping', async () => {
    // Otherwise every typo a coach ever made accumulates forever.
    mock.squadPlayer.findMany.mockResolvedValue([
      { id: 1, playerUserId: null, _count: { notes: 0 } },
    ])
    mock.$transaction.mockResolvedValue([])
    await saveSquad(7, [])
    expect(mock.squadPlayer.delete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it('treats an id the coach does not own as a new player', async () => {
    // The id comes from the client and must never be trusted into an update.
    mock.squadPlayer.findMany.mockResolvedValue([])
    mock.$transaction.mockResolvedValue([])
    await saveSquad(7, [{ id: 4321, name: 'Léo', number: '4' }])
    expect(mock.squadPlayer.update).not.toHaveBeenCalled()
    expect(mock.squadPlayer.create).toHaveBeenCalledWith({
      data: { userId: 7, name: 'Léo', number: '4', position: null, sortOrder: 0 },
    })
  })

  it('reads back only unarchived rows', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([])
    mock.$transaction.mockResolvedValue([])
    await saveSquad(7, [])
    const reads = mock.squadPlayer.findMany.mock.calls.map((c) => c[0].where)
    expect(reads.every((w) => w.archivedAt === null)).toBe(true)
  })
})
