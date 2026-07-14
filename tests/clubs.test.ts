import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

const clubPlanSub = () =>
  activeSubscription({
    plan: { id: 3, name: 'Club', slug: 'club', maxTeamMembers: 10 },
  })

function ownedClubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ownerId: 1,
    name: 'FC Test',
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [] as unknown[],
    invites: [] as unknown[],
    owner: { subscription: clubPlanSub() },
    ...overrides,
  }
}

/** Entitlements for an active club owner. */
function mockClubOwner() {
  dbMock.userSubscription.findUnique.mockResolvedValue(clubPlanSub() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
}

describe('GET /api/clubs/my', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/clubs/my' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the owned club with seat accounting', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(
      ownedClubRow({
        members: [
          { id: 1, createdAt: new Date(), user: { id: 2, name: 'A', surname: 'B', email: 'a@t.dev' } },
        ],
        invites: [
          { id: 1, email: 'c@t.dev', token: 'tok123', expiresAt: new Date(Date.now() + 86400_000), createdAt: new Date() },
        ],
      }) as never,
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/my',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.role).toBe('owner')
    expect(body.seats).toBe(10)
    expect(body.seatsUsed).toBe(2) // owner + 1 member
    expect(body.invites[0].acceptUrl).toContain('/club/join/tok123')
  })

  it('returns null for users with no club', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/my',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body === '' || res.json() === null).toBe(true)
  })
})

describe('POST /api/clubs/invites', () => {
  it('403s for non-club-owners', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/invites',
      headers: authHeaders(await accessToken()),
      payload: { email: 'newcoach@t.dev' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates an invite with an accept link', async () => {
    const app = await getApp()
    mockClubOwner()
    dbMock.club.findUnique.mockResolvedValue(ownedClubRow() as never)
    dbMock.clubInvite.create.mockResolvedValue({
      id: 7,
      clubId: 1,
      email: 'newcoach@t.dev',
      token: 'newtoken',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 14 * 86400_000),
      createdAt: new Date(),
    } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/invites',
      headers: authHeaders(await accessToken()),
      payload: { email: 'newcoach@t.dev' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().acceptUrl).toContain('/club/join/newtoken')
  })

  it('rejects invites when all seats are used', async () => {
    const app = await getApp()
    mockClubOwner()
    const members = Array.from({ length: 9 }, (_, i) => ({
      id: i,
      createdAt: new Date(),
      user: { id: i + 10, name: 'M', surname: `${i}`, email: `m${i}@t.dev` },
    }))
    dbMock.club.findUnique.mockResolvedValue(ownedClubRow({ members }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/invites',
      headers: authHeaders(await accessToken()),
      payload: { email: 'onetoomany@t.dev' },
    })
    expect(res.statusCode).toBe(422)
    expect(dbMock.clubInvite.create).not.toHaveBeenCalled()
  })

  it('409s when the email is already a member or invited', async () => {
    const app = await getApp()
    mockClubOwner()
    dbMock.club.findUnique.mockResolvedValue(
      ownedClubRow({
        members: [{ id: 1, createdAt: new Date(), user: { id: 2, name: 'A', surname: 'B', email: 'taken@t.dev' } }],
      }) as never,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/invites',
      headers: authHeaders(await accessToken()),
      payload: { email: 'taken@t.dev' },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('join flow', () => {
  it('GET /join/:token previews a valid invite', async () => {
    const app = await getApp()
    dbMock.clubInvite.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      email: 'newcoach@t.dev',
      token: 'tok',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      club: { name: 'FC Test' },
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/join/tok',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ clubName: 'FC Test', email: 'newcoach@t.dev' })
  })

  it('404s an expired invite', async () => {
    const app = await getApp()
    dbMock.clubInvite.findUnique.mockResolvedValue({
      id: 1,
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      club: { name: 'FC Test' },
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/join/tok',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /join/:token claims a seat', async () => {
    const app = await getApp()
    dbMock.clubInvite.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      email: 'newcoach@t.dev',
      token: 'tok',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      club: {
        name: 'FC Test',
        members: [],
        owner: { id: 99, subscription: clubPlanSub() },
      },
    } as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.$transaction.mockResolvedValue([] as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/join/tok',
      headers: authHeaders(await accessToken(2, 'newcoach@t.dev')),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ joined: true, clubName: 'FC Test' })
  })

  it('409s when the user already belongs to a club', async () => {
    const app = await getApp()
    dbMock.clubInvite.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400_000),
      club: { name: 'FC Test', members: [], owner: { id: 99, subscription: clubPlanSub() } },
    } as never)
    dbMock.clubMember.findUnique.mockResolvedValue({ id: 5, clubId: 2, userId: 2, createdAt: new Date() } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/join/tok',
      headers: authHeaders(await accessToken(2)),
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('DELETE /api/clubs/members/:userId', () => {
  it('lets the owner remove a member', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue({ id: 1 } as never)
    dbMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/clubs/members/2',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(204)
  })

  it('lets a member leave (self-removal)', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/clubs/members/2',
      headers: authHeaders(await accessToken(2)),
    })
    expect(res.statusCode).toBe(204)
  })

  it('403s when a member tries to remove someone else', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/clubs/members/3',
      headers: authHeaders(await accessToken(2)),
    })
    expect(res.statusCode).toBe(403)
  })
})
