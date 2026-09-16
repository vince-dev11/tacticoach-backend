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
import { coachIdsFor, clubStandingFor } from '../src/lib/club-staff.js'
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
      // The same coach coming back to it — otherwise this would be refused as
      // somebody else's note before the sent check is ever reached.
      coachUserId: 1,
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

  it('signs the note with whoever typed it, not whose squad it is', async () => {
    // A club admin standing in for a coach. The player is shown this name.
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue(null)
    mock.playerNote.create.mockResolvedValue({ id: 1 })

    await writeNote(42, 7, { squadPlayerId: 5, body: 'good week', strengths: [], workOns: [] })

    expect(mock.playerNote.create.mock.calls[0][0].data.coachUserId).toBe(42)
  })

  it('refuses to overwrite a note somebody else wrote', async () => {
    // Acting FOR a coach is not permission to edit what they said to a child,
    // even inside the 30-minute window.
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue({
      id: 3,
      createdAt: new Date(),
      sentAt: null,
      coachUserId: 1,
    })

    const result = await writeNote(42, 7, { squadPlayerId: 5, body: 'mine now', strengths: [], workOns: [] })
    expect(result).toEqual({ notYours: true })
    expect(mock.playerNote.update).not.toHaveBeenCalled()
    expect(mock.playerNote.create).not.toHaveBeenCalled()
  })

  it('looks for an existing note without filtering by author', async () => {
    // One note per player per session, whoever wrote it. Filtering by author
    // here would let an admin and a coach both write, and the player would get
    // two versions of the same session from two adults.
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue(null)
    mock.playerNote.create.mockResolvedValue({ id: 1 })

    await writeNote(42, 7, { squadPlayerId: 5, body: 'x', strengths: [], workOns: [] })

    const { where } = mock.playerNote.findFirst.mock.calls[0][0]
    expect(where).toEqual({ squadPlayerId: 5, sessionId: 7 })
  })
})

describe('club-staff — who may act for whom', () => {
  const clubPlan = (slug: string) => ({
    status: 'active',
    expiresAt: null,
    plan: { slug },
  })

  it('gives a plain coach exactly themselves', async () => {
    mock.club.findUnique.mockResolvedValue(null)
    mock.clubMember.findUnique.mockResolvedValue(null)
    expect(await coachIdsFor(9)).toEqual([9])
  })

  it('treats the club owner as an admin even though they hold no seat', async () => {
    // clubs.routes only ever creates member rows from accepted invites, so an
    // owner is never a ClubMember of their own club. Anything resolving club
    // staff through clubMember alone misses the person paying for it.
    mock.club.findUnique.mockResolvedValue({ id: 3, ownerId: 1 })
    mock.userSubscription.findUnique.mockResolvedValue(clubPlan('club'))
    mock.clubMember.findMany.mockResolvedValue([{ userId: 5 }, { userId: 6 }])

    expect((await coachIdsFor(1)).sort()).toEqual([1, 5, 6])
  })

  it('withdraws admin powers the day the club stops paying', async () => {
    mock.club.findUnique.mockResolvedValue({ id: 3, ownerId: 1 })
    mock.userSubscription.findUnique.mockResolvedValue({
      status: 'cancelled',
      expiresAt: null,
      plan: { slug: 'club' },
    })
    expect(await coachIdsFor(1)).toEqual([1])
  })

  it('does not treat a Pro owner as a club admin', async () => {
    // Owning a club row is not enough — the money has to be on the club plan.
    mock.club.findUnique.mockResolvedValue({ id: 3, ownerId: 1 })
    mock.userSubscription.findUnique.mockResolvedValue(clubPlan('pro'))
    expect(await coachIdsFor(1)).toEqual([1])
  })

  it('keeps an ordinary seat scoped to their own squad', async () => {
    mock.club.findUnique.mockResolvedValue(null)
    mock.clubMember.findUnique.mockResolvedValue({
      clubId: 3,
      role: 'member',
      club: { owner: { subscription: clubPlan('club') } },
    })
    expect(await coachIdsFor(5)).toEqual([5])
  })

  it('widens a promoted seat to every coach in the club', async () => {
    mock.club.findUnique
      .mockResolvedValueOnce(null) // not an owner
      .mockResolvedValueOnce({ ownerId: 1 }) // …looking up the club's owner
    mock.clubMember.findUnique.mockResolvedValue({
      clubId: 3,
      role: 'admin',
      club: { owner: { subscription: clubPlan('club') } },
    })
    mock.clubMember.findMany.mockResolvedValue([{ userId: 5 }, { userId: 6 }])

    expect((await coachIdsFor(5)).sort()).toEqual([1, 5, 6])
  })

  it('refuses an admin seat whose club owner has lapsed', async () => {
    mock.club.findUnique.mockResolvedValue(null)
    mock.clubMember.findUnique.mockResolvedValue({
      clubId: 3,
      role: 'admin',
      club: { owner: { subscription: null } },
    })
    expect(await coachIdsFor(5)).toEqual([5])
  })

  it('reports the owner as owner, so only they can promote anyone', async () => {
    mock.club.findUnique.mockResolvedValue({ id: 3 })
    mock.userSubscription.findUnique.mockResolvedValue(clubPlan('club'))
    expect(await clubStandingFor(1)).toEqual({ clubId: 3, isAdmin: true, isOwner: true })

    mock.club.findUnique.mockResolvedValue(null)
    mock.clubMember.findUnique.mockResolvedValue({
      clubId: 3,
      role: 'admin',
      club: { owner: { subscription: clubPlan('club') } },
    })
    expect(await clubStandingFor(5)).toEqual({ clubId: 3, isAdmin: true, isOwner: false })
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
      // squadId comes from resolveSquad, not from the client — a new player
      // lands in the squad being edited, never in one the caller named.
      data: { userId: 7, squadId: 1, name: 'Léo', number: '4', position: null, sortOrder: 0 },
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
