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
