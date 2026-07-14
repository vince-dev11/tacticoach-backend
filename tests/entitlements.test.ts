import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { activeSubscription } from './helpers.js'
import { getEntitlements } from '../src/lib/entitlements.js'

function noClubData() {
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

describe('getEntitlements', () => {
  it('grants editor access for an active subscription', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.plan?.slug).toBe('pro-ai')
    expect(ent.viaClub).toBe(false)
  })

  it('grants editor access during an unexpired trial', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'trial', expiresAt: new Date(Date.now() + 86400_000) }) as never,
    )
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.subscriptionStatus).toBe('trial')
  })

  it('denies access once the trial has expired', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'trial', expiresAt: new Date(Date.now() - 1000) }) as never,
    )
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.plan).toBeNull()
  })

  it('denies access for cancelled/expired subscriptions', async () => {
    for (const status of ['cancelled', 'expired']) {
      dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription({ status }) as never)
      noClubData()
      const ent = await getEntitlements(1)
      expect(ent.editorAccess).toBe(false)
    }
  })

  it('denies access when the user has no subscription at all (free login)', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.subscriptionStatus).toBeNull()
  })

  it('grants access via a club seat when the owner has an active club plan', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      userId: 2,
      createdAt: new Date(),
      club: {
        owner: {
          subscription: activeSubscription({
            plan: { id: 3, name: 'Club', slug: 'club' },
          }),
        },
      },
    } as never)
    dbMock.club.findUnique.mockResolvedValue(null)

    const ent = await getEntitlements(2)
    expect(ent.editorAccess).toBe(true)
    expect(ent.viaClub).toBe(true)
    expect(ent.plan?.slug).toBe('club')
  })

  it('denies club-seat access when the owner subscription lapsed', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      userId: 2,
      createdAt: new Date(),
      club: {
        owner: {
          subscription: activeSubscription({
            status: 'expired',
            plan: { id: 3, name: 'Club', slug: 'club' },
          }),
        },
      },
    } as never)
    dbMock.club.findUnique.mockResolvedValue(null)

    const ent = await getEntitlements(2)
    expect(ent.editorAccess).toBe(false)
  })

  it('denies club-seat access when the owner plan is not the club plan', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue({
      id: 1,
      clubId: 1,
      userId: 2,
      createdAt: new Date(),
      club: { owner: { subscription: activeSubscription() } }, // pro-ai, not club
    } as never)
    dbMock.club.findUnique.mockResolvedValue(null)

    const ent = await getEntitlements(2)
    expect(ent.editorAccess).toBe(false)
  })

  it('flags club ownership only with an active club-plan subscription', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ plan: { id: 3, name: 'Club', slug: 'club' } }) as never,
    )
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue({ id: 9 } as never)

    const ent = await getEntitlements(1)
    expect(ent.isClubOwner).toBe(true)
  })
})
