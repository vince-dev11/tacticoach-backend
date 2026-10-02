// Session packs (2 Oct 2026).
//
// A book or course can carry the author's own sessions. They are FROZEN when
// attached: a snapshot of the session with its library references inlined, so
// the author editing or deleting the original never changes what a reader gets.
// A reader with access to every chapter (bought, free, written, co-written)
// adds the pack to their library once: each session becomes their own editable
// copy, marked with the book it came from.
//
// Rules that matter (brief docs/briefs/2026-10-02-books-courses-v1.md):
//   - copies never count against plan or free-trial session limits
//     (plan-quota.ts excludes `sourceEbookId`), and are created without
//     reserving a free-trial slot;
//   - players never get copies (they have no sessions);
//   - a refund removes the copies (refundPurchase → removePackCopies);
//   - the author edits the pack under the same freeze as the chapters.

import { db } from '../../config/database.js'

export const PACK_MAX = 24

export class PackError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

type PackRow = { id: number; ebookId: number; sourceSessionId: number | null; title: string; snapshot: unknown; sortOrder: number }

// Untyped until `prisma generate` has seen migration 47 (the deploy runs it).
const packDb = () =>
  (db as unknown as {
    ebookSessionPack: {
      findMany(a: unknown): Promise<PackRow[]>
      deleteMany(a: unknown): Promise<{ count: number }>
      createMany(a: unknown): Promise<{ count: number }>
      count(a: unknown): Promise<number>
    }
  }).ebookSessionPack
const sessionDb = () =>
  db.trainingSession as unknown as {
    findMany(a: unknown): Promise<Record<string, unknown>[]>
    count(a: unknown): Promise<number>
    create(a: unknown): Promise<{ id: number }>
    deleteMany(a: unknown): Promise<{ count: number }>
  }

/** The fields a session is worth carrying. Dates, squads, weeks and match data stay behind. */
const CARRIED = ['title', 'description', 'targetMinutes', 'blocks', 'sessionType', 'intensityRpe', 'parts', 'ageGroup'] as const

type Block = Record<string, unknown> & { kind?: string; refId?: number | null }

/**
 * Inline the author's library into a session's blocks.
 *
 * A `board` block points at a board in the AUTHOR's library, which a reader
 * cannot open; it becomes a `drill` block carrying the board's drawing. A
 * `sheet` block keeps its words (organisation, rules, coaching points) as a
 * `drill` without a pitch. Text and drill blocks are already self-contained.
 */
export async function inlineBlocks(authorId: number, blocks: Block[]): Promise<Block[]> {
  const boardIds = blocks.filter((b) => b.kind === 'board' && b.refId).map((b) => Number(b.refId))
  const boards = boardIds.length
    ? await db.canvasBoard.findMany({ where: { id: { in: boardIds }, userId: authorId }, select: { id: true, state: true } })
    : []
  const byId = new Map(boards.map((b) => [b.id, b.state]))
  return blocks.map((b) => {
    if (b.kind === 'board') {
      const state = b.refId ? byId.get(Number(b.refId)) : undefined
      const { refId: _r, ...rest } = b
      void _r
      return { ...rest, kind: 'drill', board: (b.board as unknown) ?? (state && typeof state === 'object' && 'canvas' in (state as object) ? state : null) }
    }
    if (b.kind === 'sheet') {
      const { refId: _r, ...rest } = b
      void _r
      return { ...rest, kind: 'drill' }
    }
    return b
  })
}

/** The author's pack, in order. */
export async function listPack(ebookId: number) {
  const rows = await packDb().findMany({ where: { ebookId }, orderBy: { sortOrder: 'asc' } })
  return rows.map((r) => ({ id: r.id, sourceSessionId: r.sourceSessionId, title: r.title, blocks: Array.isArray((r.snapshot as { blocks?: unknown })?.blocks) ? ((r.snapshot as { blocks: unknown[] }).blocks.length) : 0, minutes: (r.snapshot as { targetMinutes?: number | null })?.targetMinutes ?? null }))
}

/** What the book page says: how many sessions and their titles. */
export async function packSummary(ebookId: number) {
  const rows = await packDb().findMany({ where: { ebookId }, orderBy: { sortOrder: 'asc' }, select: { title: true } }).catch(() => [] as { title: string }[])
  return { count: rows.length, titles: rows.map((r) => r.title) }
}

/**
 * Replace the pack with fresh snapshots of these sessions (the author's own,
 * training sessions only, in the order given). An empty list clears it.
 */
export async function setPack(ebookId: number, authorId: number, sessionIds: number[]) {
  const ids = [...new Set(sessionIds)].slice(0, PACK_MAX + 1)
  if (ids.length > PACK_MAX) throw new PackError(422, `A pack holds up to ${PACK_MAX} sessions.`)
  const found = ids.length
    ? await sessionDb().findMany({ where: { id: { in: ids }, userId: authorId, isMatch: false }, select: { id: true, ...Object.fromEntries(CARRIED.map((k) => [k, true])) } })
    : []
  if (found.length !== ids.length) throw new PackError(422, 'Pick your own training sessions (not matches).')
  const byId = new Map(found.map((s) => [Number(s.id), s]))
  const rows: { ebookId: number; sourceSessionId: number; title: string; snapshot: Record<string, unknown>; sortOrder: number }[] = []
  for (const [i, id] of ids.entries()) {
    const s = byId.get(id)!
    const snapshot: Record<string, unknown> = {}
    for (const k of CARRIED) snapshot[k] = s[k] ?? null
    snapshot.blocks = await inlineBlocks(authorId, Array.isArray(s.blocks) ? (s.blocks as Block[]) : [])
    rows.push({ ebookId, sourceSessionId: id, title: String(s.title ?? '').slice(0, 255) || 'Session', snapshot, sortOrder: i })
  }
  await db.$transaction(async () => {
    await packDb().deleteMany({ where: { ebookId } })
    if (rows.length) await packDb().createMany({ data: rows })
  })
  return listPack(ebookId)
}

/**
 * Add a book's pack to a reader's library — once. Returns how many sessions
 * were added (0 when they already have them). Access is checked by the caller.
 */
export async function deliverPack(ebookId: number, userId: number): Promise<{ added: number; already: boolean }> {
  const already = await sessionDb().count({ where: { userId, sourceEbookId: ebookId } })
  if (already > 0) return { added: 0, already: true }
  const pack = await packDb().findMany({ where: { ebookId }, orderBy: { sortOrder: 'asc' } })
  if (!pack.length) throw new PackError(404, 'This book has no sessions to add.')
  let added = 0
  await db.$transaction(async () => {
    for (const p of pack) {
      const snap = (p.snapshot ?? {}) as Record<string, unknown>
      // Created directly, not through withQuota: a copy is the reader's
      // purchase, not their own work, and must not use a free-trial slot.
      await sessionDb().create({
        data: {
          userId,
          sourceEbookId: ebookId,
          title: p.title,
          description: (snap.description as string | null) ?? null,
          targetMinutes: (snap.targetMinutes as number | null) ?? null,
          blocks: Array.isArray(snap.blocks) ? snap.blocks : [],
          ...(snap.sessionType ? { sessionType: snap.sessionType } : {}),
          intensityRpe: (snap.intensityRpe as number | null) ?? null,
          parts: Array.isArray(snap.parts) ? snap.parts : [],
          ageGroup: (snap.ageGroup as string | null) ?? null,
        },
      })
      added++
    }
  })
  return { added, already: false }
}

/** A refund takes the copies back (the buyer was warned before refunding). */
export async function removePackCopies(ebookId: number, userId: number): Promise<number> {
  const { count } = await sessionDb().deleteMany({ where: { userId, sourceEbookId: ebookId } })
  return count
}
