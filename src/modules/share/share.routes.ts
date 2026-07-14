// Public share endpoints — read-only views of PUBLISHED content, no login
// needed. These power the /share/board/:id and /share/sheet/:id pages that
// coaches send to players and parents. Editing/deleting stays with the owner
// through the authenticated canvas/drill-sheet routes (ownership is checked
// in every write query there).

import type { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'
import { clubBrandingActive } from '../../lib/entitlements.js'

/** Brand strip for the author's club (own club or via seat), when branded. */
async function clubStripFor(userId: number) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ownedClub: { select: { ownerId: true, name: true, badgeKey: true, primaryColor: true, slug: true, pageStatus: true } },
      clubMembership: { select: { club: { select: { ownerId: true, name: true, badgeKey: true, primaryColor: true, slug: true, pageStatus: true } } } },
    },
  })
  const club = user?.ownedClub ?? user?.clubMembership?.club ?? null
  if (!club || !club.badgeKey) return null
  // Branding rides on the owner's subscription — lapsed plan, no brand strip.
  if (!(await clubBrandingActive(club.ownerId))) return null
  return {
    name: club.name,
    badgeUrl: await presignUrl(club.badgeKey),
    primaryColor: club.primaryColor,
    // Only link to the public page once it's approved.
    slug: club.pageStatus === 'approved' ? club.slug : null,
  }
}

export async function shareRoutes(app: FastifyInstance) {
  // GET /share/board/:id — a published board's video/thumbnail + attribution
  app.get('/board/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const board = await db.canvasBoard.findFirst({
      where: { id, published: true },
      select: {
        id: true,
        userId: true,
        title: true,
        publishedAt: true,
        thumbnailKey: true,
        videoKey: true,
        user: { select: { name: true, surname: true, clubName: true } },
        _count: { select: { likes: true } },
      },
    })
    if (!board) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This board is not available' })
    }
    const [thumbnailUrl, videoUrl] = await Promise.all([
      board.thumbnailKey ? presignUrl(board.thumbnailKey) : Promise.resolve(null),
      board.videoKey ? presignUrl(board.videoKey) : Promise.resolve(null),
    ])
    return reply.send({
      id: board.id,
      title: board.title,
      publishedAt: board.publishedAt,
      author: `${board.user.name} ${board.user.surname}`.trim(),
      clubName: board.user.clubName,
      likeCount: board._count.likes,
      thumbnailUrl,
      videoUrl,
      club: await clubStripFor(board.userId),
    })
  })

  // GET /share/sheet/:id — a published drill sheet's rendered image + meta
  app.get('/sheet/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const sheet = await db.drillSheet.findFirst({
      where: { id, published: true },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        publishedAt: true,
        imageKey: true,
        user: { select: { name: true, surname: true, clubName: true } },
      },
    })
    if (!sheet) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This drill sheet is not available' })
    }
    return reply.send({
      id: sheet.id,
      title: sheet.title,
      description: sheet.description,
      publishedAt: sheet.publishedAt,
      author: `${sheet.user.name} ${sheet.user.surname}`.trim(),
      clubName: sheet.user.clubName,
      imageUrl: sheet.imageKey ? await presignUrl(sheet.imageKey) : null,
      club: await clubStripFor(sheet.userId),
    })
  })
}
