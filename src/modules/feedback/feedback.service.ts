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

/**
 * The roster for a session's feedback strip, each row carrying the note this
 * coach has already written for it (if any).
 *
 * Returns EVERY player, linked or not. A coach should be able to write about
 * a player who has no account yet — the note simply waits, and appears the
 * moment they link. Making the feature conditional on the player having paid
 * would teach coaches it is unreliable.
 */
export async function rosterForSession(coachId: number, sessionId: number) {
  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, userId: coachId },
    select: { id: true, title: true, sessionDate: true },
  })
  if (!session) return null

  const squad = await db.squadPlayer.findMany({
    where: { userId: coachId, archivedAt: null },
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
        },
      },
    },
  })

  return {
    session,
    players: squad.map(({ notes, ...player }) => ({
      ...player,
      note: notes[0] ?? null,
    })),
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
export async function writeNote(coachId: number, sessionId: number | null, input: WriteNoteInput) {
  const row = await db.squadPlayer.findFirst({
    where: { id: input.squadPlayerId, userId: coachId, archivedAt: null },
    select: { id: true },
  })
  if (!row) return null

  const { strengths, workOns } = splitTagLists(input.strengths, input.workOns)
  const body = input.body.trim()

  const existing = sessionId
    ? await db.playerNote.findFirst({
        where: { squadPlayerId: row.id, sessionId, coachUserId: coachId },
        select: { id: true, createdAt: true, sentAt: true },
      })
    : null

  if (existing) {
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
        coachUserId: coachId,
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
 * Deliver everything written for a session.
 *
 * Notes are written, reviewed, then sent — one deliberate pause between "I
 * typed it" and "a child and their parent can read it". Returns the notes that
 * were sent so the caller can email them.
 */
export async function sendSessionNotes(coachId: number, sessionId: number) {
  const pending = await db.playerNote.findMany({
    where: { sessionId, coachUserId: coachId, sentAt: null },
    select: {
      id: true,
      body: true,
      strengths: true,
      workOns: true,
      squadPlayer: {
        select: {
          name: true,
          guardianEmail: true,
          linkStatus: true,
          playerUser: { select: { id: true, name: true, email: true } },
        },
      },
    },
  })
  if (pending.length === 0) return []

  const now = new Date()
  await db.playerNote.updateMany({
    where: { id: { in: pending.map((n) => n.id) } },
    data: { sentAt: now },
  })
  return pending
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
          session: { select: { id: true, title: true, sessionDate: true } },
        },
      },
    },
  })

  const allNotes = rows.flatMap((r) => r.notes)
  return {
    squads: rows.map(({ notes, ...squad }) => ({ ...squad, notes })),
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
