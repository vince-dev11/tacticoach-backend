import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { activeSubscription } from './helpers.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { can, isPaidPlan, limitsFor } from '../src/lib/capabilities.js'

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

  it('drops an expired trial onto the FREE tier, not onto a wall', async () => {
    // The whole reason the free tier exists. A coach who hits a paywall on
    // day 8 leaves and takes eighteen players with them, and those players
    // were the only free distribution we have.
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'trial', expiresAt: new Date(Date.now() - 1000) }) as never,
    )
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.plan?.slug).toBe('free')
  })

  it('drops cancelled and expired subscriptions onto free too', async () => {
    for (const status of ['cancelled', 'expired']) {
      dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription({ status }) as never)
      noClubData()
      const ent = await getEntitlements(1)
      expect(ent.plan?.slug, `${status} should fall to free`).toBe('free')
      // The paid capabilities go, which is the part that matters.
      expect(can(ent, 'video_hd'), `${status} should lose HD`).toBe(false)
      expect(can(ent, 'own_branding'), `${status} should lose branding`).toBe(false)
      expect(can(ent, 'editor'), `${status} should keep the editor`).toBe(true)
    }
  })

  it('leaves a lapsed coach their work, capped rather than locked', async () => {
    // Five boards, not zero. Locking a coach out of boards they already made
    // would be holding their own work hostage, and it is the single fastest
    // way to make someone delete their account rather than subscribe.
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'expired' }) as never,
    )
    noClubData()

    const limits = limitsFor(await getEntitlements(1))
    expect(limits.boards).toBe(5)
    expect(limits.videoExports).toBe(3)
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

  it('gives a coach who never subscribed the free tier', async () => {
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    noClubData()

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.plan?.slug).toBe('free')
    // No row exists, and none is created. `free` is synthetic.
    expect(ent.subscriptionStatus).toBeNull()
    expect(dbMock.userSubscription.create).not.toHaveBeenCalled()
  })

  it('does not count a free coach as a paying customer', async () => {
    // editorAccess is true for everyone now, so anything that used to ask it
    // as "are they a customer?" has to ask this instead.
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    noClubData()

    const ent = await getEntitlements(1)
    expect(isPaidPlan(ent.plan?.slug)).toBe(false)
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
    // The SEAT stops granting anything the moment the owner stops paying —
    // the coach falls to free like anyone else, rather than keeping Pro on
    // somebody else's lapsed card.
    expect(ent.plan?.slug).toBe('free')
    expect(can(ent, 'own_branding')).toBe(false)
    expect(ent.viaClub).toBe(false)
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
    // A seat in a club whose owner is on an INDIVIDUAL plan grants nothing —
    // otherwise one Pro subscription would quietly cover a whole staff. The
    // member falls to free, like any other coach with no plan of their own.
    expect(ent.plan?.slug).toBe('free')
    expect(ent.viaClub).toBe(false)
    expect(can(ent, 'multi_squad')).toBe(false)
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
    //
    // accountType matters here and did not used to: before the free tier,
    // every account with no subscription got editorAccess:false anyway, so
    // this passed without ever reaching the player branch it describes. Now
    // that a coach account falls to FREE rather than to nothing, the test has
    // to actually be about a player.
    dbMock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'player' } as never)
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
    dbMock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'player' } as never)
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
