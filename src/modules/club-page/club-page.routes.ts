// Public club pages — /api/c/:slug. No auth: these are the club's shop window.
// Only clubs whose page passed CRM review (pageStatus = approved) are served;
// approval is granted/revoked in the owner admin area (/api/admin/club-pages).

import type { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'

export async function clubPageRoutes(app: FastifyInstance) {
  // GET /c/:slug — club identity + published content from all its coaches
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const club = await db.club.findFirst({
      where: { slug, pageStatus: 'approved' },
      include: {
        owner: { select: { id: true, name: true, surname: true } },
        members: { select: { user: { select: { id: true, name: true, surname: true } } } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!club) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Club page not found' })
    }

    const coachIds = [club.owner.id, ...club.members.map((m) => m.user.id)]
    const [boards, sheets] = await Promise.all([
      db.canvasBoard.findMany({
        where: { userId: { in: coachIds }, published: true },
        orderBy: { publishedAt: 'desc' },
        take: 24,
        select: {
          id: true, title: true, thumbnailKey: true, videoKey: true, publishedAt: true,
          user: { select: { name: true, surname: true } },
          _count: { select: { likes: true } },
        },
      }),
      db.drillSheet.findMany({
        where: { userId: { in: coachIds }, published: true },
        orderBy: { publishedAt: 'desc' },
        take: 24,
        select: {
          id: true, title: true, description: true, imageKey: true, publishedAt: true,
          user: { select: { name: true, surname: true } },
        },
      }),
    ])

    return reply.send({
      name: club.name,
      slug: club.slug,
      bio: club.bio,
      location: club.location,
      foundedYear: club.foundedYear,
      gallery: await Promise.all(
        club.photos.map(async (ph) => ({ id: ph.id, caption: ph.caption, imageUrl: await presignUrl(ph.imageKey) })),
      ),
      primaryColor: club.primaryColor,
      secondaryColor: club.secondaryColor,
      badgeUrl: club.badgeKey ? await presignUrl(club.badgeKey) : null,
      coaches: [
        { name: `${club.owner.name} ${club.owner.surname}`.trim(), role: 'Head of coaching' },
        ...club.members.map((m) => ({ name: `${m.user.name} ${m.user.surname}`.trim(), role: 'Coach' })),
      ],
      boards: await Promise.all(
        boards.map(async (b) => ({
          id: b.id,
          title: b.title,
          author: `${b.user.name} ${b.user.surname}`.trim(),
          likeCount: b._count.likes,
          publishedAt: b.publishedAt,
          thumbnailUrl: b.thumbnailKey ? await presignUrl(b.thumbnailKey) : null,
          hasVideo: !!b.videoKey,
        })),
      ),
      sheets: await Promise.all(
        sheets.map(async (s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          author: `${s.user.name} ${s.user.surname}`.trim(),
          publishedAt: s.publishedAt,
          imageUrl: s.imageKey ? await presignUrl(s.imageKey) : null,
        })),
      ),
    })
  })
}
