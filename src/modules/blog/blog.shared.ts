// Shared by the admin blog CMS and the coach articles module (COACH-ARTICLES,
// 20 Oct 2026): slugs, reading time, the cover URL, and the public card shape.

import { z } from 'zod'
import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'

export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const COVER_MAX = 3 * 1024 * 1024 // 3 MB

/** The admin's own blog model: does the public page carry an author byline? Yes for a coach. */
export type AuthorBasics = { id: number; name: string; surname: string | null; coachSlug: string | null }

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180) || 'post'
  )
}

export async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = base
  for (let i = 2; ; i++) {
    const clash = await db.blogPost.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
    slug = `${base}-${i}`
  }
}

export const readMinutes = (content: string) =>
  Math.max(1, Math.round(content.split(/\s+/).filter(Boolean).length / 200))

export async function withCover<T extends { coverImageKey: string | null }>(post: T) {
  return { ...post, coverUrl: post.coverImageKey ? await presignUrl(post.coverImageKey) : null }
}

/** Up to 15 keywords, each short; written by the admin only. */
/**
 * BLOG-V4 (19 Nov 2026): who an article is for and the practice it describes.
 * All optional, all free text the admin types — facts for the reader, never
 * rules (a format is never inferred from an age group).
 */
export const BLOG_FORMATS = ['5v5', '7v7', '8v8', '9v9', '11v11'] as const
const practiceText = (max: number) => z.string().trim().max(max).optional().nullable()
export const PracticeSchema = z
  .object({
    players: practiceText(40),
    area: practiceText(40),
    time: practiceText(40),
    equipment: practiceText(240),
  })
  .nullable()
export const BlogDetailsSchema = {
  ageGroup: z.string().trim().max(40).optional().nullable(),
  formats: z.array(z.enum(BLOG_FORMATS)).max(BLOG_FORMATS.length).optional().nullable(),
  practice: PracticeSchema.optional(),
}
/** An empty practice box is no practice box. */
export function cleanPractice(p: z.infer<typeof PracticeSchema> | undefined) {
  if (!p) return null
  const out = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string' && v.trim() !== ''))
  return Object.keys(out).length ? out : null
}

export const KeywordsSchema = z.array(z.string().trim().min(1).max(60)).max(15)

/**
 * The byline for a post: the coach's name and page for a coach article, nothing
 * for a team post (the blog reads as TactiCoach's own). No relation on the
 * model, so one query per batch of posts.
 */
export async function authorsFor(posts: readonly { authorId: number; authorKind: 'team' | 'coach' }[]) {
  const ids = [...new Set(posts.filter((p) => p.authorKind === 'coach').map((p) => p.authorId))]
  if (!ids.length) return new Map<number, AuthorBasics>()
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, surname: true, coachSlug: true } })
  return new Map(users.map((u) => [u.id, u]))
}

export function bylineOf(post: { authorId: number; authorKind: 'team' | 'coach' }, authors: Map<number, AuthorBasics>) {
  if (post.authorKind !== 'coach') return null
  const a = authors.get(post.authorId)
  if (!a) return null
  return { name: [a.name, a.surname].filter(Boolean).join(' '), coachSlug: a.coachSlug }
}
