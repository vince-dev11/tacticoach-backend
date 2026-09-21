// The four counted limits.
//
// These are the free tier's actual shape — five boards, five drill sheets, one
// book, one session — and the ways to get a counted limit wrong are all quiet:
// counting the wrong rows, refusing one too early, refusing one too late, or
// running the count on a plan that has no limit at all.
//
// The rule underneath all of them: a coach must always be able to make room by
// deleting something. A limit you cannot get back under is not a limit, it is
// a dead account.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { quotaState, assertQuota, allQuotas } from '../src/lib/plan-quota.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** Put user 1 on a plan, by giving or withholding a subscription. */
function onPlan(slug: string | null) {
  mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach' } as never)
  mock.userSubscription.findUnique.mockResolvedValue(
    slug
      ? {
          status: 'active',
          expiresAt: new Date(Date.now() + 86400_000),
          plan: { id: 1, name: slug, slug },
        }
      : null as never,
  )
  mock.clubMember.findUnique.mockResolvedValue(null as never)
  mock.club.findUnique.mockResolvedValue(null as never)
  mock.partner.findUnique.mockResolvedValue(null as never)
  mock.squadPlayer.findFirst.mockResolvedValue(null as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.canvasBoard.count.mockResolvedValue(0 as never)
  mock.drillSheet.count.mockResolvedValue(0 as never)
  mock.trainingSession.count.mockResolvedValue(0 as never)
  mock.ebook.count.mockResolvedValue(0 as never)
})

describe('a free coach', () => {
  beforeEach(() => onPlan(null))

  it('gets five boards, five sheets, one book and one session', () => {
    // The numbers the whole tier is specified by. If these drift, the pricing
    // page and the product stop agreeing and nothing else would say so.
    return expect(allQuotas(1)).resolves.toMatchObject({
      boards: { limit: 5 },
      drillSheets: { limit: 5 },
      books: { limit: 1 },
      sessions: { limit: 1 },
    })
  })

  it('reports what is left, not just whether they are full', async () => {
    // "4 of 5 boards" while there is still time to act on it. A tier whose
    // only signal is the refusal at number six feels broken; one that shows
    // the count feels like a plan.
    mock.canvasBoard.count.mockResolvedValue(3 as never)

    expect(await quotaState(1, 'boards')).toMatchObject({
      limit: 5, used: 3, remaining: 2, allowed: true,
    })
  })

  it('allows the fifth board and refuses the sixth', async () => {
    mock.canvasBoard.count.mockResolvedValue(4 as never)
    expect((await quotaState(1, 'boards')).allowed).toBe(true)

    mock.canvasBoard.count.mockResolvedValue(5 as never)
    expect((await quotaState(1, 'boards')).allowed).toBe(false)
  })

  it('throws a 402, never a 403', async () => {
    // The distinction the whole upgrade flow rests on: not forbidden,
    // un-upgraded. A 403 renders as "something went wrong".
    mock.canvasBoard.count.mockResolvedValue(5 as never)
    await expect(assertQuota(1, 'boards')).rejects.toMatchObject({ statusCode: 402 })
  })

  it('tells them how to get unstuck without paying', async () => {
    // Every one of these walls names the escape hatch. A coach who cannot
    // find one assumes their work is gone.
    mock.canvasBoard.count.mockResolvedValue(5 as never)
    await expect(assertQuota(1, 'boards')).rejects.toThrow(/delete one to make room/i)
  })

  it('frees the slot when something is deleted', async () => {
    // All four tables hard-delete, so a plain count is right. If any of them
    // ever gains a soft-delete column and the counter is not updated, this is
    // the test that notices — a coach who tidied up would still be full.
    mock.canvasBoard.count.mockResolvedValue(5 as never)
    await expect(assertQuota(1, 'boards')).rejects.toThrow()

    mock.canvasBoard.count.mockResolvedValue(4 as never)
    await expect(assertQuota(1, 'boards')).resolves.toBeUndefined()
  })

  it('counts only this coach’s rows', async () => {
    await quotaState(1, 'boards')
    expect(mock.canvasBoard.count).toHaveBeenCalledWith({ where: { userId: 1 } })
  })

  it('mentions publishing when it refuses the second book', async () => {
    // The free book exists so a coach finds out what the feature IS. The
    // refusal is the right place to say that publishing is the paid half.
    mock.ebook.count.mockResolvedValue(1 as never)
    await expect(assertQuota(1, 'books')).rejects.toThrow(/publish/i)
  })
})

describe('a Basic coach', () => {
  beforeEach(() => onPlan('basic'))

  it('has unlimited boards and sheets', async () => {
    expect(await quotaState(1, 'boards')).toMatchObject({ limit: null, allowed: true })
    expect(await quotaState(1, 'drillSheets')).toMatchObject({ limit: null, allowed: true })
  })

  it('still counts books and sessions', async () => {
    expect((await quotaState(1, 'books')).limit).toBe(3)
    expect((await quotaState(1, 'sessions')).limit).toBe(12)
  })

  it('never counts rows for a limit that is unlimited', async () => {
    // An unnecessary count on every board save is a query per save for a
    // number nobody reads.
    await quotaState(1, 'boards')
    expect(mock.canvasBoard.count).not.toHaveBeenCalled()
  })
})

describe('a Pro coach', () => {
  beforeEach(() => onPlan('pro'))

  it('is never refused and never counted', async () => {
    for (const q of ['boards', 'drillSheets', 'books', 'sessions'] as const) {
      await expect(assertQuota(1, q)).resolves.toBeUndefined()
    }
    expect(mock.canvasBoard.count).not.toHaveBeenCalled()
    expect(mock.ebook.count).not.toHaveBeenCalled()
  })
})

describe('the edges', () => {
  it('never reports negative remaining', async () => {
    // Reachable: two creates racing, or a limit lowered under an existing
    // account. "-2 remaining" is worse than a wrong number, it looks broken.
    onPlan(null)
    mock.canvasBoard.count.mockResolvedValue(9 as never)

    expect((await quotaState(1, 'boards')).remaining).toBe(0)
  })

  it('refuses everything for a player account', async () => {
    // Players do not author. Their limits are zero rather than absent, so a
    // bug that routed a player into a create path is refused by the quota as
    // well as by the guard above it.
    mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'player' } as never)
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 1 } as never)

    expect((await quotaState(1, 'boards')).allowed).toBe(false)
  })

  it('keeps a lapsed coach’s existing work visible, just capped', async () => {
    // Five boards, not zero. A coach whose card expired still owns what they
    // made — locking them out of their own boards is the fastest way to turn
    // a lapsed subscriber into a deleted account rather than a renewal.
    onPlan(null)
    mock.canvasBoard.count.mockResolvedValue(40 as never)

    const state = await quotaState(1, 'boards')
    expect(state.allowed).toBe(false) // cannot make a 41st
    expect(state.limit).toBe(5)
    // Nothing here deletes or hides the other 40.
    expect(mock.canvasBoard.deleteMany).not.toHaveBeenCalled()
  })
})
