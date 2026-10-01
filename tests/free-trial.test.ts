// FT-2 · the free plan is a 14-day trial (decided 1 Oct 2026); after it, the
// coach keeps the library (reads) and loses every write.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { freeTrialActive, freeTrialEnd } from '../src/lib/free-trial.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { limitsFor, can } from '../src/lib/capabilities.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const DAY = 86_400_000

beforeEach(() => {
  mock.userSubscription.findUnique.mockResolvedValue(null)
  mock.clubMember.findUnique.mockResolvedValue(null)
  mock.club.findUnique.mockResolvedValue(null)
  mock.collaborator.findUnique.mockResolvedValue(null)
  mock.squadPlayer.findFirst.mockResolvedValue(null)
})

const coach = (endsAt: Date | null) =>
  mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach', freeTrialEndsAt: endsAt })

describe('FT-2 · free trial window', () => {
  it('freeTrialEnd is 14 days after now', () => {
    const now = new Date('2026-10-01T10:00:00Z')
    expect(freeTrialEnd(now).getTime() - now.getTime()).toBe(14 * DAY)
  })

  it('the boundary instant and a missing end both count as ended', () => {
    const now = new Date('2026-10-15T10:00:00Z')
    expect(freeTrialActive(now, now)).toBe(false)
    expect(freeTrialActive(null, now)).toBe(false)
    expect(freeTrialActive(new Date(now.getTime() + 1), now)).toBe(true)
  })

  it('inside the window: free plan, editor open, the trial limits', async () => {
    coach(new Date(Date.now() + 5 * DAY))
    const ent = await getEntitlements(1)
    expect(ent).toMatchObject({ editorAccess: true, subscriptionStatus: 'free_trial', plan: { slug: 'free' } })
    expect(limitsFor(ent)).toMatchObject({ boards: 3, drillSheets: 3, sessions: 3, seasons: 1, books: 1, videoExports: 3, squads: 0 })
    expect(can(ent, 'player_feedback')).toBe(false)
    expect(can(ent, 'video_export')).toBe(true)
    expect(ent.trialEndsAt).toBeInstanceOf(Date)
  })

  it('after the window: editor closed, status free_expired, still the free plan', async () => {
    coach(new Date(Date.now() - DAY))
    const ent = await getEntitlements(1)
    expect(ent).toMatchObject({ editorAccess: false, subscriptionStatus: 'free_expired', plan: { slug: 'free' } })
  })

  it('an active subscription (including an old Pro trial) ignores the free window', async () => {
    coach(new Date(Date.now() - DAY))
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'trial', expiresAt: new Date(Date.now() + DAY), plan: { id: 9, name: 'Pro', slug: 'pro-ai' } })
    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.plan?.slug).toBe('pro-ai')
    expect(ent.trialEndsAt).toBeNull()
  })

  it('a collaborator ignores the free window', async () => {
    coach(new Date(Date.now() - DAY))
    mock.collaborator.findUnique.mockResolvedValue({ status: 'active' })
    mock.membershipPlan.findUnique.mockResolvedValue({ id: 3, name: 'Pro', slug: 'pro' })
    const ent = await getEntitlements(1)
    expect(ent).toMatchObject({ editorAccess: true, plan: { slug: 'pro' } })
  })

  it('paid tiers keep player feedback', () => {
    const paid = (slug: string) => ({ editorAccess: true, plan: { id: 1, name: slug, slug } }) as never
    for (const slug of ['basic', 'pro', 'club-10']) expect(can(paid(slug), 'player_feedback')).toBe(true)
  })
})

import { getApp, accessToken, authHeaders } from './helpers.js'

describe('FT-2 · after the trial, writes answer 402 TRIAL_ENDED and reads still work', () => {
  it('POST a board → 402 TRIAL_ENDED; GET the boards → 200', async () => {
    const app = await getApp()
    coach(new Date(Date.now() - DAY))
    mock.canvasBoard.findMany.mockResolvedValue([])
    mock.canvasBoard.count.mockResolvedValue(0)
    const headers = authHeaders(await accessToken())
    const post = await app.inject({ method: 'POST', url: '/api/canvas/boards', headers, payload: { title: 'x', canvasData: {}, frames: [] } })
    expect(post.statusCode).toBe(402)
    expect(post.json()).toMatchObject({ code: 'TRIAL_ENDED' })
    const get = await app.inject({ method: 'GET', url: '/api/canvas/boards', headers })
    expect(get.statusCode).toBe(200)
  })
})

describe('FT-4 · squads and player feedback are paid', () => {
  it('a free-trial coach cannot edit the squad roster or write feedback, but can read squads', async () => {
    const app = await getApp()
    coach(new Date(Date.now() + 5 * DAY))
    const headers = authHeaders(await accessToken())
    const writes = [
      { method: 'POST', url: '/api/users/me/squads', payload: { name: 'U12 Reds' } },
      { method: 'PUT', url: '/api/users/me/squad', payload: { players: [] } },
      { method: 'POST', url: '/api/feedback/sessions/1/notes', payload: { squadPlayerId: 1, body: 'x' } },
      { method: 'POST', url: '/api/feedback/sessions/1/send', payload: {} },
      { method: 'GET', url: '/api/feedback/sessions/1' },
    ] as const
    for (const w of writes) {
      const res = await app.inject({ ...w, headers } as never)
      expect(res.statusCode, `${w.method} ${w.url}`).toBe(402)
      expect(res.json().code, `${w.method} ${w.url}`).toBe('CAPABILITY_REQUIRED')
    }
    mock.squad.findMany.mockResolvedValue([{ id: 1, name: 'My squad', ageGroup: null, sortOrder: 0, players: [] }])
    const read = await app.inject({ method: 'GET', url: '/api/users/me/squads', headers })
    expect(read.statusCode).toBe(200)
  })

  it('a player keeps their notes and links (unaffected)', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'player', freeTrialEndsAt: null })
    mock.squadPlayer.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/api/feedback/my-notes', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
  })
})
