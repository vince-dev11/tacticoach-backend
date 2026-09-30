// Club books: private to one club, never in the shop.
//
// Who is "in" a club, for reading:
//   - the owner, and every coach with a seat (clubs.owner_id / club_members)
//   - a player whose account is linked (active) to one of those coaches
//
// Coaches read every club book, including the players' handbook — they need
// to know what their players were told. Players read only books whose
// audience is `players` or `everyone`.
//
// Writing one is the owner's, or a club admin's. It is published without our
// review: nobody outside the club can open it.

import { db } from '../../config/database.js'
import { clubStandingFor } from '../../lib/club-staff.js'

export type ClubReader = 'coach' | 'player'
export const AUDIENCES = ['coaches', 'players', 'everyone'] as const
export type ClubAudience = (typeof AUDIENCES)[number]

/** Coaches of the clubs this player is linked to, by club. */
async function playerClubIds(userId: number): Promise<number[]> {
  const links = await db.squadPlayer.findMany({
    where: { playerUserId: userId, linkStatus: 'active' },
    select: { userId: true },
  })
  const coachIds = [...new Set(links.map((l) => l.userId))]
  if (coachIds.length === 0) return []
  const clubs = await db.club.findMany({
    where: { OR: [{ ownerId: { in: coachIds } }, { members: { some: { userId: { in: coachIds } } } }] },
    select: { id: true },
  })
  return clubs.map((c) => c.id)
}

/** How this user stands in this club for reading, or null (not in it). */
export async function clubReader(userId: number | undefined, clubId: number): Promise<ClubReader | null> {
  if (!userId) return null
  const standing = await clubStandingFor(userId)
  if (standing?.clubId === clubId) return 'coach'
  return (await playerClubIds(userId)).includes(clubId) ? 'player' : null
}

export function audienceAllows(audience: string | null | undefined, reader: ClubReader | null): boolean {
  if (!reader) return false
  if (reader === 'coach') return true
  return audience === 'players' || audience === 'everyone'
}

/** May this viewer open this book? Shop books: yes. Club books: members only. */
export async function mayOpen(
  book: { clubId: number | null; clubAudience?: string | null },
  viewer: number | undefined,
): Promise<boolean> {
  if (!book.clubId) return true
  return audienceAllows(book.clubAudience, await clubReader(viewer, book.clubId))
}

/** The club a user may WRITE club books for (owner or admin), or null. */
export async function writableClub(userId: number): Promise<number | null> {
  const standing = await clubStandingFor(userId)
  return standing && (standing.isOwner || standing.isAdmin) ? standing.clubId : null
}

/** The club library for this viewer: every club book they may open. */
export async function clubLibrary(userId: number) {
  const standing = await clubStandingFor(userId)
  const asCoach = standing?.clubId ?? null
  const asPlayer = asCoach ? [] : await playerClubIds(userId)
  const clubIds = asCoach ? [asCoach] : asPlayer
  if (clubIds.length === 0) return { club: null, books: [] }
  const rows = await db.ebook.findMany({
    where: {
      clubId: { in: clubIds },
      status: 'published',
      ...(asCoach ? {} : { clubAudience: { in: ['players', 'everyone'] } }),
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true, slug: true, title: true, subtitle: true, cover: true, category: true, ageBand: true,
      isCourse: true, clubAudience: true, _count: { select: { chapters: true } },
      club: { select: { id: true, name: true, badgeKey: true } },
    },
  })
  const club = rows[0]?.club ?? (await db.club.findUnique({ where: { id: clubIds[0] }, select: { id: true, name: true, badgeKey: true } }))
  return {
    club: club ? { id: club.id, name: club.name } : null,
    canWrite: !!standing && (standing.isOwner || standing.isAdmin),
    books: rows.map(({ club: _c, _count, ...b }) => ({ ...b, chapters: _count.chapters })),
  }
}

/**
 * Who has read a club course, for the club owner: each coach's progress and
 * score. Coaches only — a player's reading is between them and their coach.
 */
export async function clubReaders(userId: number, ebookId: number) {
  const standing = await clubStandingFor(userId)
  if (!standing || !(standing.isOwner || standing.isAdmin)) return null
  const book = await db.ebook.findFirst({
    where: { id: ebookId, clubId: standing.clubId },
    select: { id: true, isCourse: true, chapters: { select: { key: true } } },
  })
  if (!book) return null
  const club = await db.club.findUnique({
    where: { id: standing.clubId },
    select: {
      owner: { select: { id: true, name: true, surname: true } },
      members: { select: { user: { select: { id: true, name: true, surname: true } } } },
    },
  })
  const people = [club?.owner, ...(club?.members ?? []).map((m) => m.user)].filter(Boolean) as { id: number; name: string; surname: string | null }[]
  const ids = people.map((p) => p.id)
  const [reads, answers, certs] = await Promise.all([
    db.ebookChapterRead.findMany({ where: { ebookId, userId: { in: ids } }, select: { userId: true } }),
    db.ebookQuizAnswer.findMany({ where: { ebookId, userId: { in: ids } }, select: { userId: true, correct: true } }),
    db.ebookCertificate.findMany({ where: { ebookId, userId: { in: ids }, revokedAt: null }, select: { userId: true } }),
  ])
  const certified = new Set(certs.map((c) => c.userId))
  return {
    chapters: book.chapters.length,
    isCourse: book.isCourse,
    readers: people.map((p) => {
      const mine = answers.filter((a) => a.userId === p.id)
      return {
        userId: p.id,
        name: [p.name, p.surname].filter(Boolean).join(' '),
        read: reads.filter((r) => r.userId === p.id).length,
        score: mine.length ? Math.round((mine.filter((a) => a.correct).length / mine.length) * 100) : null,
        certified: certified.has(p.id),
      }
    }),
  }
}
