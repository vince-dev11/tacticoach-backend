// FT-3 · the season planner on the free trial: one season plan, ever, and a
// copied week or season spends session slots like any other session.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { copyWeek } from '../src/modules/plans/plans.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

beforeEach(() => {
  mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach', freeTrialEndsAt: new Date(Date.now() + 5 * 86_400_000) })
  mock.userSubscription.findUnique.mockResolvedValue(null)
  mock.clubMember.findUnique.mockResolvedValue(null)
  mock.club.findUnique.mockResolvedValue(null)
  mock.collaborator.findUnique.mockResolvedValue(null)
  mock.squadPlayer.findFirst.mockResolvedValue(null)
  mock.freeUsage.upsert.mockResolvedValue({})
})

describe('FT-3 · seasons on the free trial', () => {
  it('a second season plan is refused with 402 QUOTA_REACHED seasons', async () => {
    const app = await getApp()
    mock.$executeRaw.mockResolvedValue(0) // the one slot is spent
    const res = await app.inject({
      method: 'POST', url: '/api/plans', headers: authHeaders(await accessToken()),
      payload: { title: 'Second season', startDate: '2027-09-06', weeks: 4 },
    })
    expect(res.statusCode).toBe(402)
    expect(res.json()).toMatchObject({ code: 'QUOTA_REACHED', quota: 'seasons', limit: 1, lifetime: true })
    expect(mock.seasonPlan.create).not.toHaveBeenCalled()
  })
})

describe('FT-3 · copying a week spends session slots', () => {
  function weeks(n: number) {
    mock.planWeek.findFirst
      .mockResolvedValueOnce({ id: 1, startDate: d('2026-09-07'), plan: { weekStartsOn: 1 }, sessions: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `S${i}`, sessionDate: d('2026-09-08'), blocks: [], brand: {}, parts: [], isMatch: false })) })
      .mockResolvedValueOnce({ id: 2, startDate: d('2026-09-14'), plan: { weekStartsOn: 1 } })
  }

  it('claims as many slots as sessions copied', async () => {
    weeks(2)
    mock.$executeRaw.mockResolvedValue(1)
    mock.trainingSession.createMany.mockResolvedValue({ count: 2 })
    await copyWeek(1, 1, 2)
    const call = mock.$executeRaw.mock.calls[0] as unknown[]
    expect(call[3]).toBe(2) // col, col, count, …
  })

  it('refuses before creating anything when they do not fit', async () => {
    weeks(2)
    mock.$executeRaw.mockResolvedValue(0)
    await expect(copyWeek(1, 1, 2)).rejects.toMatchObject({ statusCode: 402, quota: 'sessions' })
    expect(mock.trainingSession.createMany).not.toHaveBeenCalled()
  })
})
