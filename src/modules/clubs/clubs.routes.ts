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
}
