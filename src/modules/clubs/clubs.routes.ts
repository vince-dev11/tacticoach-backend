// Clubs — the Club plan's seat system.
//
// The club row is created automatically when a club-plan subscription
// activates (see membership.service). The owner invites coaches by email:
// an invite token/link is generated which the invited coach opens while
// logged in to claim their seat. Members get editor access through the
// owner's subscription (see lib/entitlements).

import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { sendClubInviteEmail } from '../../lib/emails.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

const MEMBER_SELECT = {
  id: true,
  createdAt: true,
  user: { select: { id: true, name: true, surname: true, email: true } },
} as const

async function ownedClub(userId: number) {
  return db.club.findUnique({
    where: { ownerId: userId },
    include: {
      members: { select: MEMBER_SELECT, orderBy: { createdAt: 'asc' } },
      invites: { where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } },
      owner: { select: { subscription: { include: { plan: true } } } },
    },
  })
}

export async function clubsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  // GET /clubs/my — the club I own (with members + pending invites) or the
  // club I'm a member of (members only, no invite management data).
  app.get('/my', async (request, reply) => {
    const userId = (request.user as any).sub as number

    const club = await ownedClub(userId)
    if (club) {
      const seats = club.owner.subscription?.plan.maxTeamMembers ?? 10
      return reply.send({
        role: 'owner',
        id: club.id,
        name: club.name,
        seats,
        // Owner occupies one seat.
        seatsUsed: club.members.length + 1,
        members: club.members,
        invites: club.invites.map((i) => ({
          id: i.id,
          email: i.email,
          expiresAt: i.expiresAt,
          acceptUrl: `${env.FRONTEND_URL}/club/join/${i.token}`,
        })),
      })
    }

    const membership = await db.clubMember.findUnique({
      where: { userId },
      include: {
        club: {
          include: {
            owner: { select: { id: true, name: true, surname: true } },
            members: { select: MEMBER_SELECT, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })
    if (!membership) return reply.send(null)
    return reply.send({
      role: 'member',
      id: membership.club.id,
      name: membership.club.name,
      owner: membership.club.owner,
      members: membership.club.members,
    })
  })

  // POST /clubs/invites { email } — owner only, seat-capped
  app.post('/invites', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { email } = z.object({ email: z.string().email() }).parse(request.body)

    const ent = await getEntitlements(userId)
    if (!ent.isClubOwner) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'An active Club plan is required to invite members' })
    }
    const club = await ownedClub(userId)
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Club not found' })

    const seats = club.owner.subscription?.plan.maxTeamMembers ?? 10
    const seatsUsed = club.members.length + 1 + club.invites.length
    if (seatsUsed >= seats) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `All ${seats} seats are used (members + pending invites)` })
    }
    const alreadyMember = club.members.some((m) => m.user.email === email)
    const alreadyInvited = club.invites.some((i) => i.email === email)
    if (alreadyMember || alreadyInvited) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'This email is already a member or has a pending invite' })
    }

    const invite = await db.clubInvite.create({
      data: {
        clubId: club.id,
        email,
        token: randomBytes(24).toString('hex'),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    })

    // Email the accept link to the invited coach (fire-and-forget — the owner
    // still gets the acceptUrl below to share manually either way).
    const acceptUrl = `${env.FRONTEND_URL}/club/join/${invite.token}`
    const inviter = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, surname: true },
    })
    void sendClubInviteEmail({
      to: invite.email,
      clubName: club.name,
      inviterName: inviter ? `${inviter.name} ${inviter.surname}`.trim() : 'A coach',
      acceptUrl,
      expiresAt: invite.expiresAt,
    })

    return reply.status(201).send({
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
      acceptUrl,
    })
  })

  // DELETE /clubs/invites/:id — revoke a pending invite
  app.delete('/invites/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const club = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Club not found' })
    await db.clubInvite.deleteMany({ where: { id: Number(id), clubId: club.id, acceptedAt: null } })
    return reply.status(204).send()
  })

  // GET /clubs/join/:token — invite details (shown on the accept page)
  app.get('/join/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const invite = await db.clubInvite.findUnique({
      where: { token },
      include: { club: { select: { name: true } } },
    })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Invite not found or expired' })
    }
    return reply.send({ clubName: invite.club.name, email: invite.email })
  })

  // POST /clubs/join/:token — claim the seat as the logged-in user
  app.post('/join/:token', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { token } = request.params as { token: string }

    const invite = await db.clubInvite.findUnique({
      where: { token },
      include: {
        club: {
          include: {
            members: { select: { id: true } },
            owner: { select: { id: true, subscription: { include: { plan: true } } } },
          },
        },
      },
    })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Invite not found or expired' })
    }
    if (invite.club.owner.id === userId) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'You own this club' })
    }
    const existing = await db.clubMember.findUnique({ where: { userId } })
    if (existing) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'You already belong to a club' })
    }
    const seats = invite.club.owner.subscription?.plan.maxTeamMembers ?? 10
    if (invite.club.members.length + 1 >= seats) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'No seats left in this club' })
    }

    await db.$transaction([
      db.clubMember.create({ data: { clubId: invite.clubId, userId } }),
      db.clubInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    ])
    return reply.send({ joined: true, clubName: invite.club.name })
  })

  // DELETE /clubs/members/:userId — owner removes a member (or a member leaves)
  app.delete('/members/:userId', async (request, reply) => {
    const requesterId = (request.user as any).sub as number
    const targetId = Number((request.params as { userId: string }).userId)

    const club = await db.club.findUnique({ where: { ownerId: requesterId }, select: { id: true } })
    if (club) {
      await db.clubMember.deleteMany({ where: { clubId: club.id, userId: targetId } })
      return reply.status(204).send()
    }
    if (requesterId === targetId) {
      await db.clubMember.deleteMany({ where: { userId: requesterId } })
      return reply.status(204).send()
    }
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the club owner can remove members' })
  })

  // ===== Branding & public page (owner only) ==================================

  const BADGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const BADGE_MAX = 2 * 1024 * 1024 // 2 MB
  const REQUIRED_PUBLISHED = 3

  const BrandingSchema = z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    slug: z
      .string()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only')
      .optional()
      .nullable(),
    bio: z.string().max(1000).optional().nullable(),
    location: z.string().max(150).optional().nullable(),
    foundedYear: z.number().int().min(1800).max(2100).optional().nullable(),
  })

  // Reserved slugs that would collide with app routes or look official.
  const RESERVED_SLUGS = new Set(['admin', 'tacticoach', 'official', 'api', 'blog', 'club', 'clubs', 'share', 'login', 'signup'])

  /** Published boards + drill sheets across the whole club (owner + members). */
  async function clubPublishedCount(clubId: number, ownerId: number): Promise<number> {
    const members = await db.clubMember.findMany({ where: { clubId }, select: { userId: true } })
    const userIds = [ownerId, ...members.map((m) => m.userId)]
    const [boards, sheets] = await Promise.all([
      db.canvasBoard.count({ where: { userId: { in: userIds }, published: true } }),
      db.drillSheet.count({ where: { userId: { in: userIds }, published: true } }),
    ])
    return boards + sheets
  }

  /** The gate a club must pass before its page can be submitted for review. */
  async function brandingEligibility(userId: number, club: { id: number; ownerId: number }) {
    const [ent, owner, publishedCount] = await Promise.all([
      getEntitlements(userId),
      db.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      clubPublishedCount(club.id, club.ownerId),
    ])
    return {
      planActive: ent.isClubOwner,
      emailVerified: !!owner.emailVerifiedAt,
      publishedCount,
      publishedRequired: REQUIRED_PUBLISHED,
      eligible: ent.isClubOwner && !!owner.emailVerifiedAt && publishedCount >= REQUIRED_PUBLISHED,
    }
  }

  // GET /clubs/branding — brand kit + eligibility checklist (owner only)
  app.get('/branding', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const club = await db.club.findUnique({ where: { ownerId: userId } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })
    const [eligibility, photos] = await Promise.all([
      brandingEligibility(userId, club),
      db.clubPhoto.findMany({ where: { clubId: club.id }, orderBy: { sortOrder: 'asc' } }),
    ])
    return reply.send({
      name: club.name,
      badgeUrl: club.badgeKey ? await presignUrl(club.badgeKey) : null,
      primaryColor: club.primaryColor,
      secondaryColor: club.secondaryColor,
      slug: club.slug,
      bio: club.bio,
      location: club.location,
      foundedYear: club.foundedYear,
      photos: await Promise.all(
        photos.map(async (ph) => ({ id: ph.id, caption: ph.caption, imageUrl: await presignUrl(ph.imageKey) })),
      ),
      pageStatus: club.pageStatus,
      pageReviewNote: club.pageReviewNote,
      pageUrl: club.pageStatus === 'approved' && club.slug ? `${env.FRONTEND_URL}/c/${club.slug}` : null,
      eligibility,
    })
  })

  // PATCH /clubs/branding — update colours/slug/bio
  app.patch('/branding', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const club = await db.club.findUnique({ where: { ownerId: userId } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })
    const input = BrandingSchema.parse(request.body)

    if (input.slug) {
      if (RESERVED_SLUGS.has(input.slug)) {
        return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'That address is reserved — pick another' })
      }
      const clash = await db.club.findFirst({ where: { slug: input.slug, id: { not: club.id } }, select: { id: true } })
      if (clash) {
        return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'That address is already taken' })
      }
    }

    const updated = await db.club.update({
      where: { id: club.id },
      data: {
        ...(input.primaryColor !== undefined && { primaryColor: input.primaryColor }),
        ...(input.secondaryColor !== undefined && { secondaryColor: input.secondaryColor }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.foundedYear !== undefined && { foundedYear: input.foundedYear }),
      },
    })
    return reply.send({ slug: updated.slug, primaryColor: updated.primaryColor, secondaryColor: updated.secondaryColor, bio: updated.bio })
  })

  // POST /clubs/branding/badge — club badge upload
  app.post('/branding/badge', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const club = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true, badgeKey: true } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })

    const file = await readUpload(request, { maxBytes: BADGE_MAX, allowedTypes: BADGE_TYPES })
    if (club.badgeKey) await deleteFromS3(club.badgeKey).catch(() => {})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `clubs/${club.id}/badge-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.club.update({ where: { id: club.id }, data: { badgeKey: key } })
    return reply.send({ badgeUrl: await presignUrl(key) })
  })

  // POST /clubs/branding/photos — gallery upload (awards, team photos…)
  const MAX_PHOTOS = 8
  const PHOTO_MAX = 3 * 1024 * 1024 // 3 MB

  app.post('/branding/photos', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const club = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })

    const count = await db.clubPhoto.count({ where: { clubId: club.id } })
    if (count >= MAX_PHOTOS) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `Gallery is full (max ${MAX_PHOTOS} photos) — remove one first` })
    }

    const file = await readUpload(request, { maxBytes: PHOTO_MAX, allowedTypes: BADGE_TYPES })
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `clubs/${club.id}/gallery/${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    const photo = await db.clubPhoto.create({
      data: { clubId: club.id, imageKey: key, sortOrder: count },
    })
    return reply.status(201).send({ id: photo.id, caption: photo.caption, imageUrl: await presignUrl(key) })
  })

  // PATCH /clubs/branding/photos/:id { caption }
  app.patch('/branding/photos/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const { caption } = z.object({ caption: z.string().max(200).nullable() }).parse(request.body)
    const club = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })
    const result = await db.clubPhoto.updateMany({ where: { id, clubId: club.id }, data: { caption } })
    if (result.count === 0) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Photo not found' })
    return reply.send({ id, caption })
  })

  // DELETE /clubs/branding/photos/:id
  app.delete('/branding/photos/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const club = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })
    const photo = await db.clubPhoto.findFirst({ where: { id, clubId: club.id } })
    if (!photo) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Photo not found' })
    await deleteFromS3(photo.imageKey).catch(() => {})
    await db.clubPhoto.delete({ where: { id } })
    return reply.status(204).send()
  })

  // POST /clubs/branding/submit — request public-page review (gate enforced)
  app.post('/branding/submit', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const club = await db.club.findUnique({ where: { ownerId: userId } })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'You do not own a club' })
    if (club.pageStatus === 'approved') {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Your page is already approved' })
    }
    if (!club.slug || !club.badgeKey) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Upload a badge and choose a page address first' })
    }
    const eligibility = await brandingEligibility(userId, club)
    if (!eligibility.eligible) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `Not eligible yet: publish ${eligibility.publishedRequired} items (${eligibility.publishedCount}/${eligibility.publishedRequired}), verify your email and keep your Club plan active.`,
        eligibility,
      })
    }
    const updated = await db.club.update({
      where: { id: club.id },
      data: { pageStatus: 'pending', pageSubmittedAt: new Date(), pageReviewNote: null },
    })
    return reply.send({ pageStatus: updated.pageStatus })
  })
}
