// Coach branding — a coach's own public page (/coach/:slug) and the brand
// strip that rides on everything they share.
//
// This is the solo-coach counterpart of club branding. A Club row only exists
// for Club-plan owners, so without this the typical individual subscriber had
// no branded presence at all: no page, no photo on their shares, just a plain
// "by Name" byline.
//
// Goes live WITHOUT review (unlike club pages): the page is public as soon as
// the coach has a slug, hasn't switched it off, has an active plan (trial
// included — the page is a reason to subscribe) and has published at least
// one board or drill sheet. Any of those lapsing takes the page down again,
// with the brand kit preserved.

import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { env } from '../../config/env.js'

export const COACH_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const COACH_SLUG_RESERVED = new Set([
  'admin', 'tacticoach', 'official', 'api', 'blog', 'club', 'clubs', 'coach', 'coaches',
  'share', 'login', 'signup', 'me', 'new', 'edit', 'settings', 'profile', 'dashboard',
])

const BRAND_SELECT = {
  id: true,
  name: true,
  surname: true,
  clubName: true,
  clubLogoKey: true,
  instagramUrl: true,
  youtubeUrl: true,
  twitterUrl: true,
  facebookUrl: true,
  coachLevel: true,
  coachAgeGroup: true,
  coachSlug: true,
  coachPhotoKey: true,
  coachColor: true,
  coachBio: true,
  coachTitle: true,
  coachPageEnabled: true,
  emailVerifiedAt: true,
} as const

interface BrandRow {
  id: number
  name: string
  surname: string
  clubName: string | null
  clubLogoKey: string | null
  instagramUrl: string | null
  youtubeUrl: string | null
  twitterUrl: string | null
  facebookUrl: string | null
  coachLevel: string | null
  coachAgeGroup: string | null
  coachSlug: string | null
  coachPhotoKey: string | null
  coachColor: string | null
  coachBio: string | null
  coachTitle: string | null
  coachPageEnabled: boolean
  emailVerifiedAt: Date | null
}

export interface CoachPageStatus {
  live: boolean
  hasSlug: boolean
  enabled: boolean
  planActive: boolean
  publishedCount: number
  publishedRequired: number
  pageUrl: string | null
}

const REQUIRED_PUBLISHED = 1

export async function publishedCountFor(userId: number): Promise<number> {
  const [boards, sheets] = await Promise.all([
    db.canvasBoard.count({ where: { userId, published: true } }),
    db.drillSheet.count({ where: { userId, published: true } }),
  ])
  return boards + sheets
}

/** The go-live checklist for a coach, and whether every box is ticked. */
export async function coachPageStatus(user: Pick<BrandRow, 'id' | 'coachSlug' | 'coachPageEnabled'>): Promise<CoachPageStatus> {
  const [ent, publishedCount] = await Promise.all([getEntitlements(user.id), publishedCountFor(user.id)])
  const hasSlug = !!user.coachSlug
  const planActive = ent.editorAccess
  const live = hasSlug && user.coachPageEnabled && planActive && publishedCount >= REQUIRED_PUBLISHED
  return {
    live,
    hasSlug,
    enabled: user.coachPageEnabled,
    planActive,
    publishedCount,
    publishedRequired: REQUIRED_PUBLISHED,
    pageUrl: live ? `${env.FRONTEND_URL}/coach/${user.coachSlug}` : null,
  }
}

/** The coach's brand kit as the Profile → Branding section shows it. */
export async function getBrandKit(userId: number) {
  const user: BrandRow | null = await db.user.findUnique({ where: { id: userId }, select: BRAND_SELECT })
  if (!user) return null
  const status = await coachPageStatus(user)
  return {
    slug: user.coachSlug,
    photoUrl: user.coachPhotoKey ? await presignUrl(user.coachPhotoKey) : null,
    color: user.coachColor,
    bio: user.coachBio,
    title: user.coachTitle,
    enabled: user.coachPageEnabled,
    status,
  }
}

/**
 * Compact identity strip attached to shared boards/sheets and community
 * cards: photo, name, colour, and a link to the page (only while it's live).
 */
export async function coachStripFor(userId: number) {
  const user: BrandRow | null = await db.user.findUnique({ where: { id: userId }, select: BRAND_SELECT })
  if (!user) return null
  const status = await coachPageStatus(user)
  return {
    name: `${user.name} ${user.surname}`.trim(),
    title: user.coachTitle,
    color: user.coachColor,
    photoUrl: user.coachPhotoKey ? await presignUrl(user.coachPhotoKey) : null,
    slug: status.live ? user.coachSlug : null,
  }
}

/** Everything the public page renders, or null when the page isn't live. */
export async function getCoachPage(slug: string) {
  const user: BrandRow | null = await db.user.findFirst({ where: { coachSlug: slug }, select: BRAND_SELECT })
  if (!user) return null
  const status = await coachPageStatus(user)
  if (!status.live) return null

  interface BoardRow {
    id: number
    title: string
    thumbnailKey: string | null
    videoKey: string | null
    publishedAt: Date | null
    tags: unknown
    ageGroup: string | null
    _count: { likes: number }
  }
  interface SheetRow {
    id: number
    title: string
    description: string | null
    imageKey: string | null
    publishedAt: Date | null
    _count: { likes: number }
  }
  interface WinRow {
    id: number
    createdAt: Date
    challenge: { id: number; title: string; endsAt: Date }
    _count: { votes: number }
  }

  const [boards, sheets, wins, club]: [BoardRow[], SheetRow[], WinRow[], { name: string; slug: string | null; pageStatus: string; badgeKey: string | null } | null] =
    await Promise.all([
      db.canvasBoard.findMany({
        where: { userId: user.id, published: true },
        orderBy: { publishedAt: 'desc' },
        take: 36,
        select: {
          id: true, title: true, thumbnailKey: true, videoKey: true, publishedAt: true, tags: true, ageGroup: true,
          _count: { select: { likes: true } },
        },
      }),
      db.drillSheet.findMany({
        where: { userId: user.id, published: true },
        orderBy: { publishedAt: 'desc' },
        take: 36,
        select: { id: true, title: true, description: true, imageKey: true, publishedAt: true, _count: { select: { likes: true } } },
      }),
      // Weekly-challenge wins: the coach's submissions on closed challenges
      // where theirs had the most votes. Computed here from the same data the
      // Hall of Fame uses, so a win shows in both places or neither.
      db.challengeSubmission.findMany({
        where: { userId: user.id, challenge: { endsAt: { lt: new Date() } } },
        select: { id: true, createdAt: true, challenge: { select: { id: true, title: true, endsAt: true } }, _count: { select: { votes: true } } },
      }),
      db.user.findUnique({
        where: { id: user.id },
        select: {
          ownedClub: { select: { name: true, slug: true, pageStatus: true, badgeKey: true } },
          clubMembership: { select: { club: { select: { name: true, slug: true, pageStatus: true, badgeKey: true } } } },
        },
      }).then((u) => u?.ownedClub ?? u?.clubMembership?.club ?? null),
    ])

  // A win = top vote count on that challenge (ties go to the earliest entry,
  // matching listSubmissions' ranking).
  const featured: { challengeId: number; title: string; endsAt: Date; votes: number }[] = []
  for (const w of wins) {
    const rivals: { userId: number; createdAt: Date; _count: { votes: number } }[] = await db.challengeSubmission.findMany({
      where: { challengeId: w.challenge.id },
      select: { userId: true, createdAt: true, _count: { select: { votes: true } } },
    })
    rivals.sort((a, b) => b._count.votes - a._count.votes || a.createdAt.getTime() - b.createdAt.getTime())
    if (rivals[0]?.userId === user.id) {
      featured.push({ challengeId: w.challenge.id, title: w.challenge.title, endsAt: w.challenge.endsAt, votes: w._count.votes })
    }
  }
  featured.sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())

  const likes =
    boards.reduce((n, b) => n + b._count.likes, 0) + sheets.reduce((n, s) => n + s._count.likes, 0)

  return {
    name: `${user.name} ${user.surname}`.trim(),
    slug: user.coachSlug,
    title: user.coachTitle,
    bio: user.coachBio,
    color: user.coachColor,
    level: user.coachLevel,
    ageGroup: user.coachAgeGroup,
    photoUrl: user.coachPhotoKey ? await presignUrl(user.coachPhotoKey) : null,
    clubName: user.clubName,
    clubLogoUrl: user.clubLogoKey ? await presignUrl(user.clubLogoKey) : null,
    club: club
      ? {
          name: club.name,
          badgeUrl: club.badgeKey ? await presignUrl(club.badgeKey) : null,
          slug: club.pageStatus === 'approved' ? club.slug : null,
        }
      : null,
    socials: {
      instagram: user.instagramUrl,
      youtube: user.youtubeUrl,
      twitter: user.twitterUrl,
      facebook: user.facebookUrl,
    },
    stats: { boards: boards.length, sheets: sheets.length, likes, wins: featured.length },
    featured,
    boards: await Promise.all(
      boards.map(async (b) => ({
        id: b.id,
        title: b.title,
        likeCount: b._count.likes,
        publishedAt: b.publishedAt,
        thumbnailUrl: b.thumbnailKey ? await presignUrl(b.thumbnailKey) : null,
        hasVideo: !!b.videoKey,
        category: Array.isArray(b.tags) ? (b.tags[0] as string | undefined) ?? null : null,
        ageGroup: b.ageGroup,
      })),
    ),
    sheets: await Promise.all(
      sheets.map(async (s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        likeCount: s._count.likes,
        publishedAt: s.publishedAt,
        imageUrl: s.imageKey ? await presignUrl(s.imageKey) : null,
      })),
    ),
  }
}
