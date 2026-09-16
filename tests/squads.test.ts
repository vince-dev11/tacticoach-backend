// A coach's teams.
//
// Two things here are worth breaking a build over, and neither is CRUD:
//
//   1. Saving one squad must not touch another. The squad editor is
//      replace-all, so an unscoped save would archive every player in the
//      coach's OTHER teams as "dropped" — silently, on a routine save.
//   2. Moving a player must move the ROW. The row carries their account link
//      and every note ever written to them, so a promotion from the U13s to
//      the U15s must not hand a child a blank season.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock, TEST_SQUAD } from './setup.js'
import { saveSquad, getSquad } from '../src/modules/users/users.service.js'
import { movePlayer, archiveSquad, defaultSquad, resolveSquad } from '../src/modules/users/squads.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => vi.clearAllMocks())

describe('saveSquad is scoped to one squad', () => {
  it('only reads the squad being edited', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([])
    mock.$transaction.mockResolvedValue([])

    await saveSquad(7, [], TEST_SQUAD.id)

    // Without squadId in this where-clause, every player in the coach's other
    // teams would look "dropped" and be archived on a routine save.
    for (const call of mock.squadPlayer.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ userId: 7, squadId: TEST_SQUAD.id })
    }
  })

  it('creates new players into the squad being edited', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([])
    mock.$transaction.mockResolvedValue([])

    await saveSquad(7, [{ name: 'Ali', number: '3' }], TEST_SQUAD.id)

    expect(mock.squadPlayer.create.mock.calls[0][0].data).toMatchObject({
      userId: 7,
      squadId: TEST_SQUAD.id,
    })
  })

  it('still archives rather than deletes a dropped player who has notes', async () => {
    // The squad split must not weaken the rule that notes are the PLAYER's.
    mock.squadPlayer.findMany.mockResolvedValue([
      { id: 3, playerUserId: null, _count: { notes: 2 } },
    ])
    mock.$transaction.mockResolvedValue([])

    await saveSquad(7, [], TEST_SQUAD.id)

    expect(mock.squadPlayer.delete).not.toHaveBeenCalled()
    expect(mock.squadPlayer.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date)
  })
})

describe('movePlayer', () => {
  it('updates the row instead of recreating it', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 12 })
    mock.squadPlayer.count.mockResolvedValue(4)
    mock.squadPlayer.update.mockResolvedValue({})

    expect(await movePlayer(1, 12, 9)).toBe(true)

    // The whole point: one UPDATE. A delete-and-create would give the child a
    // new row, and their note history hangs off the old one.
    expect(mock.squadPlayer.delete).not.toHaveBeenCalled()
    expect(mock.squadPlayer.create).not.toHaveBeenCalled()
    expect(mock.squadPlayer.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { squadId: 9, sortOrder: 4 },
    })
  })

  it('refuses a player the coach does not own', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue(null)
    expect(await movePlayer(1, 12, 9)).toBe(false)
    expect(mock.squadPlayer.update).not.toHaveBeenCalled()
  })

  it('refuses a destination squad the coach does not own', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 12 })
    mock.squad.findFirst.mockResolvedValue(null)
    expect(await movePlayer(1, 12, 9999)).toBe(false)
    expect(mock.squadPlayer.update).not.toHaveBeenCalled()
  })
})

describe('archiveSquad', () => {
  it('will not archive the last one', async () => {
    // A coach with no squads gets one recreated on the next read, which looks
    // like the app undoing what they just did.
    mock.squad.findMany.mockResolvedValue([{ id: 1 }])
    expect(await archiveSquad(1, 1)).toEqual({ ok: false, reason: 'last_one' })
    expect(mock.squad.update).not.toHaveBeenCalled()
  })

  it('archives rather than deletes, so the notes survive', async () => {
    mock.squad.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    mock.squad.update.mockResolvedValue({})

    expect(await archiveSquad(1, 2)).toEqual({ ok: true })
    expect(mock.squad.delete).not.toHaveBeenCalled()
    expect(mock.squad.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date)
  })

  it('refuses a squad belonging to someone else', async () => {
    mock.squad.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    expect(await archiveSquad(1, 77)).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('resolveSquad', () => {
  it('falls back to the default rather than reading another coach\'s squad', async () => {
    // A stale id — a squad archived in another tab, or one simply guessed —
    // must never resolve to somebody else's players.
    mock.squad.findFirst
      .mockResolvedValueOnce(null)        // the id is not this coach's
      .mockResolvedValueOnce(TEST_SQUAD)  // …so the default answers instead

    expect(await resolveSquad(1, 4242)).toEqual(TEST_SQUAD)
  })

  it('makes a first squad for a coach who has none', async () => {
    // Every account starts here. Making each call site handle "no squad yet"
    // is how half of them forget.
    mock.squad.findFirst.mockResolvedValue(null)
    mock.user.findUnique.mockResolvedValue({ coachAgeGroup: 'U13' })
    mock.squad.create.mockResolvedValue({ ...TEST_SQUAD, name: 'U13' })

    const squad = await defaultSquad(1)
    expect(squad.name).toBe('U13')
    // Named from the coach's own age group, so their first team reads "U13"
    // rather than something generic they have to rename.
    expect(mock.squad.create.mock.calls[0][0].data).toMatchObject({ name: 'U13', ageGroup: 'U13' })
  })
})

describe('getSquad', () => {
  it('returns the squad alongside its players, so the client knows which it got', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([{ id: 1, name: 'Leo' }])
    const result = await getSquad(1, TEST_SQUAD.id)
    expect(result.squad).toEqual(TEST_SQUAD)
    expect(result.players).toHaveLength(1)
  })

  it('never returns archived players', async () => {
    mock.squadPlayer.findMany.mockResolvedValue([])
    await getSquad(1, TEST_SQUAD.id)
    expect(mock.squadPlayer.findMany.mock.calls[0][0].where.archivedAt).toBeNull()
  })
})
