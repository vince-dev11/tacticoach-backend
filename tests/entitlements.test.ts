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

  it('the company owner has full access whatever their subscription row says', async () => {
    // Role decides, not the row: an expired trial, a cancelled plan or no row at
    // all must never lock the owner out or show them a trial banner.
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    for (const sub of [
      activeSubscription({ status: 'trial', expiresAt: new Date('2026-07-22T17:11:02.866Z') }),
      activeSubscription({ status: 'cancelled' }),
      activeSubscription({ status: 'expired', expiresAt: new Date(Date.now() - 1000) }),
      null,
    ]) {
      dbMock.userSubscription.findUnique.mockResolvedValue(sub as never)
      noClubData()
      const ent = await getEntitlements(1)
      expect(ent.editorAccess).toBe(true)
      expect(ent.plan?.slug).toBe('owner')
      expect(ent.subscriptionStatus).toBe('active') // never 'trial' → no countdown/ended banner
      expect(ent.expiresAt).toBeNull()
    }
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
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

describe('the retired player plan', () => {
  // The player plan is retired — players are free, and prisma/seed carries the
  // reasoning. Two things follow, and both are easy to break by accident:
  //
  //   1. Anyone who ALREADY holds one keeps what they paid for. Withdrawing
  //      access from a live subscriber because the tier was discontinued is
  //      theft, and it is exactly what a `slug !== 'player'` guard added in
  //      good faith somewhere would do.
  //   2. playerAccess no longer has anything to do with a subscription. It is
  //      "is this person somebody's player?" and nothing else.
  const playerSub = () => activeSubscription({ plan: { id: 9, name: 'Player', slug: 'player' } })

  it('still honours a subscription somebody already paid for', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(playerSub() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.squadPlayer.findFirst.mockResolvedValue(null as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.plan?.slug).toBe('player')
  })

  it('does not hand out player screens for holding the old plan', async () => {
    // playerAccess used to be `isPlayerPlan || linkedToSquad`. It is now the
    // link alone: a legacy subscriber who is nobody's player has no player
    // screens to show, because there is no feedback addressed to them.
    dbMock.userSubscription.findUnique.mockResolvedValue(playerSub() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.squadPlayer.findFirst.mockResolvedValue(null as never)

    expect((await getEntitlements(1)).playerAccess).toBe(false)
  })

  it('gives a linked player their own screens even with no subscription', async () => {
    // Their club or their coach pays; the notes are still theirs to read.
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.squadPlayer.findFirst.mockResolvedValue({ id: 4 } as never)

    const ent = await getEntitlements(1)
    expect(ent.playerAccess).toBe(true)
    // Reading what your coach wrote you is not a licence to author.
    expect(ent.editorAccess).toBe(false)
  })

  it('takes the product back when the player stops paying', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'cancelled', plan: { id: 9, name: 'Player', slug: 'player' } }) as never,
    )
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.squadPlayer.findFirst.mockResolvedValue(null as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.playerAccess).toBe(false)
  })
})
