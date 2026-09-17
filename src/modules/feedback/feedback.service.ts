// Player feedback: linking a player's account to a roster row, and the notes
// a coach writes them.
//
// Two rules run through everything here:
//
//   1. A coach knowing an email address is never enough. Linking creates a
//      PENDING request; only the player's own acceptance activates it.
//   2. Notes are the PLAYER's record. A coach can stop writing, and can take a
//      player off the roster, but cannot make what they already wrote vanish.

import { db } from '../../config/database.js'
import { splitTagLists, tagFrequency } from '../../lib/feedback-tags.js'
import { coachIdsFor } from '../../lib/club-staff.js'
import { resolveSquad } from '../users/squads.service.js'

/**
 * How long a coach can fix a note after writing it.
 *
 * Long enough to correct a typo or soften a sentence written straight after a
 * bad result; short enough that nobody can quietly rewrite history after a
 * parent has read it. Sending freezes a note immediately regardless.
 */
export const NOTE_EDIT_WINDOW_MS = 30 * 60 * 1000

export function noteIsEditable(note: { createdAt: Date; sentAt: Date | null }, now = new Date()): boolean {
  if (note.sentAt) return false
  return now.getTime() - note.createdAt.getTime() < NOTE_EDIT_WINDOW_MS
}

// ---- Linking ----------------------------------------------------------------

/**
 * Does this email have a player account?
 *
 * Returns a boolean and nothing else — no name, no id, no "did you mean".
 * A coach needs to know whether to ask the player to sign up; anything richer
 * turns the box into a tool for checking who has an account.
 */
export async function playerAccountExists(email: string): Promise<boolean> {
  const user = await db.user.findFirst({
    where: { email: email.trim().toLowerCase(), accountType: 'player' },
    select: { id: true },
  })
  return !!user
}

/**
 * Coach asks to link a player account to one of their roster rows.
 *
 * Creates a pending request. Nothing is visible to the coach and nothing can
 * be written until the player accepts.
 */
export async function requestLink(
  coachId: number,
  squadPlayerId: number,
  email: string,
): Promise<{ ok: true } | { ok: false; reason: 'no_account' | 'not_yours' | 'already_linked' | 'in_another_row' }> {
  const row = await db.squadPlayer.findFirst({
    where: { id: squadPlayerId, userId: coachId, archivedAt: null },
    select: { id: true, playerUserId: true },
  })
  if (!row) return { ok: false, reason: 'not_yours' }
  if (row.playerUserId) return { ok: false, reason: 'already_linked' }

  const player = await db.user.findFirst({
    where: { email: email.trim().toLowerCase(), accountType: 'player' },
    select: { id: true },
  })
  if (!player) return { ok: false, reason: 'no_account' }

  // This coach may already have the same player on a different row — the
  // @@unique([userId, playerUserId]) would refuse it, so say so plainly
  // instead of surfacing a constraint error.
  const clash = await db.squadPlayer.findFirst({
    where: { userId: coachId, playerUserId: player.id },
    select: { id: true },
  })
  if (clash) return { ok: false, reason: 'in_another_row' }

  await db.squadPlayer.update({
    where: { id: row.id },
    data: { playerUserId: player.id, linkStatus: 'pending', linkedAt: null },
  })
  return { ok: true }
}

/** Every coach link a player has — pending ones to answer, active ones to leave. */
export async function linksForPlayer(playerUserId: number) {
  return db.squadPlayer.findMany({
    where: { playerUserId, archivedAt: null },
    orderBy: [{ linkStatus: 'asc' }, { linkedAt: 'desc' }],
    select: {
      id: true,
      name: true,
      number: true,
      position: true,
      linkStatus: true,
      linkedAt: true,
      user: { select: { name: true, surname: true, clubName: true, coachTitle: true } },
    },
  })
}

/** The player answers. Accepting activates; declining clears the link entirely. */
export async function answerLink(
  playerUserId: number,
  squadPlayerId: number,
  accept: boolean,
): Promise<boolean> {
  const row = await db.squadPlayer.findFirst({
    where: { id: squadPlayerId, playerUserId, linkStatus: 'pending' },
    select: { id: true },
  })
  if (!row) return false

  await db.squadPlayer.update({
    where: { id: row.id },
    data: accept
      ? { linkStatus: 'active', linkedAt: new Date() }
      : { playerUserId: null, linkStatus: null, linkedAt: null },
  })
  return true
}

/**
 * Either side unlinks.
 *
 * The roster row and every note already written stay exactly where they are —
 * the coach simply loses the ability to add more, and the player keeps their
 * record. Removing someone from a team should not delete what was said to them.
 */
export async function unlink(squadPlayerId: number, by: { coachId?: number; playerUserId?: number }): Promise<boolean> {
  const row = await db.squadPlayer.findFirst({
    where: {
      id: squadPlayerId,
      ...(by.coachId !== undefined ? { userId: by.coachId } : {}),
      ...(by.playerUserId !== undefined ? { playerUserId: by.playerUserId } : {}),
    },
    select: { id: true },
  })
  if (!row) return false
  await db.squadPlayer.update({
    where: { id: row.id },
    data: { playerUserId: null, linkStatus: null, linkedAt: null },
  })
  return true
}

// ---- Writing ----------------------------------------------------------------

/** Name for display, falling back to something rather than an empty string. */
const authorName = (u: { name: string; surname: string | null } | null) =>
  u ? [u.name, u.surname].filter(Boolean).join(' ') : ''

/**
 * The roster for a session's feedback strip, each row carrying the note
 * already written for it (if any).
 *
 * Returns EVERY player, linked or not. A coach should be able to write about
 * a player who has no account yet — the note simply waits, and appears the
 * moment they link. Making the feature conditional on the player having paid
 * would teach coaches it is unreliable.
 *
 * `viewerId` may be the session's own coach or a club admin standing in for
 * them. Two things follow from that, and both matter:
 *
 *   - the roster is the SESSION OWNER's squad, never the viewer's. An admin
 *     opening a coach's session must see that coach's players.
 *   - notes are returned whatever their author, so a stand-in can see the
 *     coach already wrote to someone instead of writing a second note.
 */
export async function rosterForSession(viewerId: number, sessionId: number) {
  const coachIds = await coachIdsFor(viewerId)

  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, userId: { in: coachIds } },
    select: {
      id: true,
      title: true,
      sessionDate: true,
      userId: true,
      squadId: true,
      user: { select: { name: true, surname: true } },
    },
  })
  if (!session) return null

  // The team this session was for, not every player the coach knows. A coach
  // with a U13 and a U15 group was being offered all thirty names for a
  // session twenty of them were not at, which is the difference between a
  // twenty-second job and one nobody does twice.
  //
  // Resolved against the SESSION'S owner, not the viewer: a club admin
  // standing in must see that coach's squad.
  const squadId = (await resolveSquad(session.userId, session.squadId)).id

  const squad = await db.squadPlayer.findMany({
    where: { userId: session.userId, squadId, archivedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      number: true,
      position: true,
      linkStatus: true,
      notes: {
        where: { sessionId },
        select: {
          id: true,
          body: true,
          strengths: true,
          workOns: true,
          boardId: true,
          sentAt: true,
          readAt: true,
          createdAt: true,
          coachUserId: true,
          coach: { select: { name: true, surname: true } },
        },
      },
    },
  })

  const { userId: sessionCoachId, user: sessionCoach, ...sessionInfo } = session
  return {
    session: sessionInfo,
    /** Whose session this is — the admin needs to know they are standing in. */
    coach: { id: sessionCoachId, name: authorName(sessionCoach) },
    /** So the client can tell its own drafts from a colleague's. */
    viewerId,
    players: squad.map(({ notes, ...player }) => {
      const note = notes[0]
      return {
        ...player,
        note: note
          ? {
              ...note,
              author: { id: note.coachUserId, name: authorName(note.coach) },
              mine: note.coachUserId === viewerId,
            }
          : null,
      }
    }),
  }
}

export interface WriteNoteInput {
  squadPlayerId: number
  body: string
  strengths: unknown
  workOns: unknown
  boardId?: number | null
}

/**
 * Write (or rewrite) the note for one player on one session.
 *
 * One note per player per session: a coach coming back to add a thought is
 * editing, not stacking. Upsert-by-hand because the unique key we would need
 * (squadPlayerId + sessionId) would forbid the several standalone notes a
 * coach can leave outside a session.
 */
export async function writeNote(viewerId: number, sessionId: number | null, input: WriteNoteInput) {
  const coachIds = await coachIdsFor(viewerId)

  const row = await db.squadPlayer.findFirst({
    where: { id: input.squadPlayerId, userId: { in: coachIds }, archivedAt: null },
    select: { id: true },
  })
  if (!row) return null

  const { strengths, workOns } = splitTagLists(input.strengths, input.workOns)
  const body = input.body.trim()

  // Looked up WITHOUT an author filter. One note per player per session, no
  // matter who wrote it: if a club admin and the coach both write, the player
  // gets two versions of the same session from two adults, which is worse than
  // either of them saying nothing.
  const existing = sessionId
    ? await db.playerNote.findFirst({
        where: { squadPlayerId: row.id, sessionId },
        select: { id: true, createdAt: true, sentAt: true, coachUserId: true },
      })
    : null

  if (existing) {
    // A stand-in may write where nobody has, but not over somebody's words.
    // Being allowed to act for a coach is not the same as being allowed to
    // edit what they said to a child.
    if (existing.coachUserId !== viewerId) return { notYours: true as const }
    if (!noteIsEditable(existing)) return { locked: true as const }
    return {
      note: await db.playerNote.update({
        where: { id: existing.id },
        data: { body, strengths, workOns, boardId: input.boardId ?? null },
      }),
    }
  }

  return {
    note: await db.playerNote.create({
      data: {
        squadPlayerId: row.id,
        // Whoever actually typed it, which is not necessarily whose squad it
        // is. The player is shown this name, not the squad owner's.
        coachUserId: viewerId,
        sessionId,
        boardId: input.boardId ?? null,
        body,
        strengths,
        workOns,
      },
    }),
  }
}

/** Remove a note the coach has not sent yet. */
export async function discardNote(coachId: number, noteId: number): Promise<boolean> {
  const { count } = await db.playerNote.deleteMany({
    where: { id: noteId, coachUserId: coachId, sentAt: null },
  })
  return count > 0
}

/**
 * What a player's email says about their season so far, with THIS coach.
 *
 * Scoped to the squad row rather than the player, because the row is the
 * relationship: a child at a club and a school has two coaches and two
 * records, and blending them would tell their school coach's email what their
 * club coach has been working on.
 *
 * Counted over sent notes only — a draft is not part of anyone's history yet.
 */
export interface SeasonDigest {
  /** How many notes this coach has sent them, including the one being sent. */
  total: number
  strengths: [string, number][]
  workOns: [string, number][]
}

async function seasonDigests(squadPlayerIds: number[]): Promise<Map<number, SeasonDigest>> {
  const digests = new Map<number, SeasonDigest>()
  if (squadPlayerIds.length === 0) return digests

  // One query for the whole batch. A squad of twenty was twenty round trips
  // when this was done per player, on a path a coach waits for.
  const notes = await db.playerNote.findMany({
    where: { squadPlayerId: { in: squadPlayerIds }, sentAt: { not: null } },
    select: { squadPlayerId: true, strengths: true, workOns: true },
  })

  const byPlayer = new Map<number, { strengths: unknown; workOns: unknown }[]>()
  for (const note of notes) {
    const list = byPlayer.get(note.squadPlayerId) ?? []
    list.push(note)
    byPlayer.set(note.squadPlayerId, list)
  }

  for (const id of squadPlayerIds) {
    const list = byPlayer.get(id) ?? []
    digests.set(id, { total: list.length, ...tagFrequency(list) })
  }
  return digests
}

/**
 * Deliver everything written for a session.
 *
 * Notes are written, reviewed, then sent — one deliberate pause between "I
 * typed it" and "a child and their parent can read it". Returns the notes that
 * were sent, each carrying what the email needs to be a report rather than a
 * notification: who it is about, which session, and where they are up to.
 *
 * The digest is computed AFTER the rows are marked sent, so the note being
 * delivered counts itself — "your 7th note this season" has to include the one
 * the reader is holding, or it is off by one for everybody.
 */
export async function sendSessionNotes(coachId: number, sessionId: number) {
  const pending = await db.playerNote.findMany({
    where: { sessionId, coachUserId: coachId, sentAt: null },
    select: {
      id: true,
      body: true,
      strengths: true,
      workOns: true,
      boardId: true,
      squadPlayerId: true,
      squadPlayer: {
        select: {
          id: true,
          name: true,
          guardianEmail: true,
          linkStatus: true,
          playerUser: { select: { id: true, name: true, email: true } },
        },
      },
      session: { select: { title: true, sessionDate: true } },
    },
  })
  if (pending.length === 0) return []

  const now = new Date()
  await db.playerNote.updateMany({
    where: { id: { in: pending.map((n) => n.id) } },
    data: { sentAt: now },
  })

  const digests = await seasonDigests([...new Set(pending.map((n) => n.squadPlayerId))])
  return pending.map((note) => ({
    ...note,
    digest: digests.get(note.squadPlayerId) ?? { total: 1, strengths: [], workOns: [] },
  }))
}

// ---- Reading ----------------------------------------------------------------

/**
 * One player's own feedback, newest first, across every coach they are linked
 * to — grouped by coach, because a player at a club and a school has two.
 *
 * Only SENT notes: a draft a coach is still working on is not the player's
 * business yet.
 */
export async function notesForPlayer(playerUserId: number) {
  const rows = await db.squadPlayer.findMany({
    where: { playerUserId, linkStatus: 'active' },
    select: {
      id: true,
      name: true,
      number: true,
      position: true,
      user: { select: { name: true, surname: true, clubName: true } },
      notes: {
        where: { sentAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          body: true,
          strengths: true,
          workOns: true,
          boardId: true,
          readAt: true,
          createdAt: true,
          coachUserId: true,
          coach: { select: { name: true, surname: true } },
          session: { select: { id: true, title: true, sessionDate: true } },
        },
      },
    },
  })

  const allNotes = rows.flatMap((r) => r.notes)
  return {
    // Each note names whoever wrote it, which is not always the coach who owns
    // the squad — a club admin can stand in. A child reading "from your coach"
    // under words a different adult wrote is the kind of small dishonesty that
    // makes the whole thing feel automated.
    squads: rows.map(({ notes, ...squad }) => ({
      ...squad,
      notes: notes.map(({ coach, coachUserId, ...note }) => ({
        ...note,
        author: { id: coachUserId, name: authorName(coach) },
      })),
    })),
    /** "Scanning, six times this season" — the answer to "am I getting better?" */
    summary: tagFrequency(allNotes),
    unread: allNotes.filter((n) => !n.readAt).length,
  }
}

/** Mark notes read. Drives a tick for the coach and nothing else. */
export async function markNotesRead(playerUserId: number, noteIds: number[]): Promise<void> {
  if (noteIds.length === 0) return
  await db.playerNote.updateMany({
    where: {
      id: { in: noteIds },
      readAt: null,
      sentAt: { not: null },
      squadPlayer: { playerUserId, linkStatus: 'active' },
    },
    data: { readAt: new Date() },
  })
}
