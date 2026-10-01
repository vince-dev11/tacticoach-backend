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
import { quotaState, assertQuota, allQuotas, claimQuota } from '../src/lib/plan-quota.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** Put user 1 on a plan, by giving or withholding a subscription. */
function onPlan(slug: string | null) {
  // No plan = a coach inside the 14-day free trial.
  mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach', freeTrialEndsAt: new Date(Date.now() + 5 * 86_400_000) } as never)
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
  mock.collaborator.findUnique.mockResolvedValue(null as never)
  mock.squadPlayer.findFirst.mockResolvedValue(null as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.canvasBoard.count.mockResolvedValue(0 as never)
  mock.drillSheet.count.mockResolvedValue(0 as never)
  mock.trainingSession.count.mockResolvedValue(0 as never)
  mock.ebook.count.mockResolvedValue(0 as never)
  mock.seasonPlan.count.mockResolvedValue(0 as never)
  mock.freeUsage.findUnique.mockResolvedValue(null as never)
})

describe('a free coach (14-day trial, FT-3)', () => {
  beforeEach(() => onPlan(null))

  it('gets three boards, three sheets, three sessions, one season and one book', () => {
    return expect(allQuotas(1)).resolves.toMatchObject({
      boards: { limit: 3, lifetime: true },
      drillSheets: { limit: 3 },
      sessions: { limit: 3 },
      seasons: { limit: 1 },
      books: { limit: 1 },
    })
  })

  it('counts creations from free_usage, not live rows — deleting does not free a slot', async () => {
    mock.freeUsage.findUnique.mockResolvedValue({ boards: 3 } as never)
    mock.canvasBoard.count.mockResolvedValue(0 as never) // all three deleted
    expect(await quotaState(1, 'boards')).toMatchObject({ limit: 3, used: 3, remaining: 0, allowed: false, lifetime: true })
    expect(mock.canvasBoard.count).not.toHaveBeenCalled()
  })

  it('reserves atomically: the conditional update is the gate', async () => {
    mock.freeUsage.upsert.mockResolvedValue({} as never)
    mock.$executeRaw.mockResolvedValueOnce(1 as never).mockResolvedValueOnce(0 as never)
    await expect(claimQuota(1, 'boards')).resolves.toBeTypeOf('function')
    await expect(claimQuota(1, 'boards')).rejects.toMatchObject({
      statusCode: 402, code: 'QUOTA_REACHED', quota: 'boards', limit: 3, lifetime: true,
    })
  })

  it('says deleted items still count when it refuses', async () => {
    mock.freeUsage.upsert.mockResolvedValue({} as never)
    mock.$executeRaw.mockResolvedValue(0 as never)
    await expect(claimQuota(1, 'boards')).rejects.toThrow(/deleted boards still count/i)
  })

  it('release gives the slot back when the create fails', async () => {
    mock.freeUsage.upsert.mockResolvedValue({} as never)
    mock.$executeRaw.mockResolvedValue(1 as never)
    const release = await claimQuota(1, 'seasons')
    await release()
    const call = mock.$executeRaw.mock.calls.at(-1)! as unknown[]
    expect((call[0] as TemplateStringsArray).join('?')).toMatch(/GREATEST\(\? - \?, 0\)/)
    expect(call[3]).toBe(1) // params: col, col, count, userId — one slot back
  })

  it('mentions publishing when it refuses the second book', async () => {
    mock.freeUsage.upsert.mockResolvedValue({} as never)
    mock.$executeRaw.mockResolvedValue(0 as never)
    await expect(claimQuota(1, 'books')).rejects.toThrow(/publish/i)
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
    // Reachable: an account backfilled over the new limit at release.
    onPlan(null)
    mock.freeUsage.findUnique.mockResolvedValue({ boards: 9 } as never)
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

  it('keeps an over-the-limit coach’s existing work, just refuses a new one', async () => {
    // Backfilled at release with 40 boards: none is deleted or hidden.
    onPlan(null)
    mock.freeUsage.findUnique.mockResolvedValue({ boards: 40 } as never)
    const state = await quotaState(1, 'boards')
    expect(state.allowed).toBe(false)
    expect(state.limit).toBe(3)
    expect(mock.canvasBoard.deleteMany).not.toHaveBeenCalled()
  })
})
