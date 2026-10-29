// CRM-PIPELINE (28 Oct 2026, owner): stages, follow-ups, deal value, a
// timeline, and the account each lead became. Owner-only.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { pipelineOf, endOfToday } from '../src/modules/admin/crm.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
let role: 'owner' | 'user' = 'owner'
const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
  const app = await getApp()
  return app.inject({ method, url, headers: authHeaders(await accessToken()), payload: payload as never })
}
beforeEach(() => {
  vi.clearAllMocks()
  role = 'owner'
  dbMock.user.findUnique.mockImplementation((() => Promise.resolve({ id: 1, role, accountType: 'coach' })) as never)
})

describe('CRM-PIPELINE · the numbers', () => {
  it('counts stages, open value, follow-ups due and win rate by channel', () => {
    const now = new Date('2026-10-28T12:00:00Z')
    const p = pipelineOf([
      { stage: 'new', channel: 'instagram', dealValuePence: 899, followUpAt: new Date('2026-10-28T09:00:00Z'), stageChangedAt: null },
      { stage: 'demo', channel: 'instagram', dealValuePence: 3999, followUpAt: new Date('2026-11-02T09:00:00Z'), stageChangedAt: null },
      { stage: 'won', channel: 'instagram', dealValuePence: 899, followUpAt: new Date('2026-10-01T09:00:00Z'), stageChangedAt: new Date('2026-10-05T00:00:00Z') },
      { stage: 'lost', channel: null, dealValuePence: 500, followUpAt: null, stageChangedAt: null },
    ], now)
    expect(p.byStage).toMatchObject({ new: 1, demo: 1, won: 1, lost: 1 })
    expect(p.openValuePence).toBe(899 + 3999)
    expect(p.followUpsDue).toBe(1) // the won lead's old follow-up doesn't count
    expect(p.wonThisMonth).toBe(1)
    expect(p.winRate).toBe(0.5)
    expect(p.byChannel[0]).toMatchObject({ channel: 'instagram', total: 3, won: 1 })
    expect(endOfToday(now).toISOString()).toBe('2026-10-28T23:59:59.999Z')
  })
})

describe('CRM-PIPELINE · routes', () => {
  it('owner only', async () => {
    role = 'user'
    expect((await call('GET', '/api/admin/leads/pipeline')).statusCode).toBe(403)
    expect((await call('POST', '/api/admin/leads/3/notes', { text: 'x' })).statusCode).toBe(403)
  })

  it('moving a stage records it on the timeline; a follow-up date too', async () => {
    mock.contactMessage.findUnique.mockResolvedValue({ stage: 'contacted', followUpAt: null } as never)
    mock.contactMessage.update.mockResolvedValue({ id: 3, stage: 'demo' } as never)
    const res = await call('PATCH', '/api/admin/leads/3', { stage: 'demo', followUpAt: '2026-11-02T09:00:00.000Z', dealValuePence: 3999 })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.update.mock.calls[0][0].data).toMatchObject({ stage: 'demo', dealValuePence: 3999, followUpAt: new Date('2026-11-02T09:00:00.000Z') })
    const texts = mock.leadActivity.create.mock.calls.map((c) => c[0].data.text)
    expect(texts).toEqual(['Contacted → Demo', 'Follow up on 2026-11-02'])
  })

  it('a lost lead keeps the reason on the timeline', async () => {
    mock.contactMessage.findUnique.mockResolvedValue({ stage: 'trial', followUpAt: null } as never)
    mock.contactMessage.update.mockResolvedValue({ id: 3 } as never)
    await call('PATCH', '/api/admin/leads/3', { stage: 'lost', lostReason: 'Too expensive' })
    expect(mock.leadActivity.create.mock.calls[0][0].data.text).toBe('Trial → Lost — Too expensive')
  })

  it('each lead shows the account it became: paying, trial or free', async () => {
    mock.contactMessage.findMany.mockResolvedValue([
      { id: 1, email: 'Pay@Club.dev' }, { id: 2, email: 'new@club.dev' },
    ] as never)
    mock.user.findMany.mockResolvedValue([
      { id: 9, email: 'pay@club.dev', createdAt: new Date('2026-10-01'), accountType: 'coach', freeTrialEndsAt: null, subscription: { status: 'active', expiresAt: null, paymentProvider: 'stripe' } },
    ] as never)
    const res = await call('GET', '/api/admin/leads')
    expect(res.statusCode).toBe(200)
    const rows = res.json() as { id: number; account: { plan: string } | null }[]
    expect(rows[0].account?.plan).toBe('paying')
    expect(rows[1].account).toBeNull()
  })

  it('a note needs words', async () => {
    mock.contactMessage.findUnique.mockResolvedValue({ id: 3 } as never)
    expect((await call('POST', '/api/admin/leads/3/notes', { text: '  ' })).statusCode).toBe(422)
    expect((await call('POST', '/api/admin/leads/3/notes', { text: 'Called — wants a demo Tuesday' })).statusCode).toBe(201)
    expect(mock.leadActivity.create.mock.calls[0][0].data).toMatchObject({ leadId: 3, kind: 'note', createdById: 1 })
  })
})
