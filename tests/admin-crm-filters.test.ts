// CRM (6 Oct 2026) — leads record where they heard about us (Facebook,
// Instagram…), and Admin → Users can be filtered, with trials ending within
// 7 days counted and flagged.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { normaliseChannel, LEAD_CHANNELS } from '../src/modules/admin/lead-channels.js'
import { UserFilters, userWhere, trialEndsAt } from '../src/modules/admin/user-filters.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function asOwner() {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    }
    return Promise.resolve({ id: 1, role: 'owner', accountType: 'coach' } as never)
  })
}
const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
  const app = await getApp()
  return app.inject({ method, url, headers: authHeaders(await accessToken()), payload: payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  asOwner()
})

describe('CRM · lead channel ("came from")', () => {
  it('reads what people actually type', () => {
    expect(normaliseChannel('Insta')).toBe('instagram')
    expect(normaliseChannel('FB')).toBe('facebook')
    expect(normaliseChannel('Twitter')).toBe('x')
    expect(normaliseChannel('word of mouth')).toBe('word_of_mouth')
    expect(normaliseChannel('TikTok')).toBe('tiktok')
    expect(normaliseChannel('a poster in the clubhouse')).toBe('other')
    expect(normaliseChannel('')).toBeNull()
    expect(normaliseChannel(undefined)).toBeNull()
    expect(LEAD_CHANNELS).toContain('facebook')
  })

  it('a lead added by hand keeps its channel', async () => {
    mock.contactMessage.findFirst.mockResolvedValue(null as never)
    mock.contactMessage.create.mockResolvedValue({ id: 5 } as never)
    const res = await call('POST', '/api/admin/leads', { firstName: 'Sam', email: 'sam@t.dev', channel: 'instagram' })
    expect(res.statusCode).toBe(201)
    expect(mock.contactMessage.create.mock.calls[0][0].data.channel).toBe('instagram')
  })

  it('an import maps a "channel" column', async () => {
    mock.contactMessage.findMany.mockResolvedValue([] as never)
    mock.contactMessage.createMany.mockResolvedValue({ count: 2 } as never)
    await call('POST', '/api/admin/leads/import', {
      rows: [
        { firstName: 'A', email: 'a@t.dev', channel: 'FB' },
        { firstName: 'B', email: 'b@t.dev' },
      ],
    })
    const data = mock.contactMessage.createMany.mock.calls[0][0].data
    expect(data[0].channel).toBe('facebook')
    expect(data[1].channel).toBeNull()
  })

  it('PATCH sets and clears it, and refuses an unknown one', async () => {
    mock.contactMessage.update.mockResolvedValue({ id: 3 } as never)
    expect((await call('PATCH', '/api/admin/leads/3', { channel: 'tiktok' })).statusCode).toBe(200)
    expect(mock.contactMessage.update.mock.calls.at(-1)[0].data).toEqual({ channel: 'tiktok' })
    await call('PATCH', '/api/admin/leads/3', { channel: null })
    expect(mock.contactMessage.update.mock.calls.at(-1)[0].data).toEqual({ channel: null })
    expect((await call('PATCH', '/api/admin/leads/3', { channel: 'myspace' })).statusCode).toBe(422)
  })

  it('the list filters by channel, and `none` finds the ones still to fill in', async () => {
    mock.contactMessage.findMany.mockResolvedValue([] as never)
    await call('GET', '/api/admin/leads?channel=facebook')
    expect(mock.contactMessage.findMany.mock.calls.at(-1)[0].where.channel).toBe('facebook')
    await call('GET', '/api/admin/leads?channel=none')
    expect(mock.contactMessage.findMany.mock.calls.at(-1)[0].where.channel).toBeNull()
    await call('GET', '/api/admin/leads?channel=nonsense')
    expect(mock.contactMessage.findMany.mock.calls.at(-1)[0].where).not.toHaveProperty('channel')
  })
})

describe('CRM · Admin → Users filters', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const json = (f: Record<string, string>) => JSON.stringify(userWhere(UserFilters.parse(f), now))

  it('no filters → everyone; nonsense values are ignored, not refused', () => {
    expect(userWhere(UserFilters.parse({}), now)).toEqual({})
    expect(userWhere(UserFilters.parse({ type: 'alien', plan: 'x', joined: '5', page: '-3' }), now)).toEqual({})
    expect(UserFilters.parse({ page: '-3' }).page).toBe(1)
  })

  it('trial ending = a free trial OR a trial subscription ending within 7 days', () => {
    const w = json({ plan: 'trial_ending' })
    expect(w).toContain('"freeTrialEndsAt":{"gt":"2026-10-06T12:00:00.000Z","lte":"2026-10-13T12:00:00.000Z"}')
    expect(w).toContain('"status":"trial","expiresAt":{"gt":"2026-10-06T12:00:00.000Z","lte":"2026-10-13T12:00:00.000Z"}')
    // A free trial only counts for someone nothing else covers.
    expect(w).toContain('"accountType":{"not":"player"}')
    expect(w).toContain('"clubMembership":{"is":null}')
  })

  it('type, verified, joined and content combine with AND', () => {
    const w = userWhere(UserFilters.parse({ type: 'club', verified: 'no', joined: '30', content: 'none', search: 'rovers' }), now)
    const and = (w as { AND: unknown[] }).AND
    expect(and).toHaveLength(5)
    expect(and).toContainEqual({ accountType: 'club' })
    expect(and).toContainEqual({ emailVerifiedAt: null })
    expect(and).toContainEqual({ createdAt: { gte: new Date('2026-09-06T12:00:00Z') } })
    expect(and).toContainEqual({ boards: { none: {} }, drillSheets: { none: {} } })
  })

  it('paid and gift are told apart by who paid', () => {
    expect(json({ plan: 'paid' })).toContain('"paymentProvider":"stripe"')
    expect(json({ plan: 'gift' })).toContain('"paymentProvider":"complimentary"')
    expect(json({ plan: 'lapsed' })).toContain('"in":["cancelled","expired"]')
  })

  it('trialEndsAt per row: free trial, sub trial, or none when something paid covers them', () => {
    const end = new Date('2026-10-09T00:00:00Z')
    expect(trialEndsAt({ accountType: 'coach', freeTrialEndsAt: end, subscription: null }, now)).toEqual(end)
    expect(trialEndsAt({ accountType: 'coach', freeTrialEndsAt: null, subscription: { status: 'trial', expiresAt: end } }, now)).toEqual(end)
    expect(trialEndsAt({ accountType: 'coach', freeTrialEndsAt: end, subscription: { status: 'active', expiresAt: null } }, now)).toBeNull()
    expect(trialEndsAt({ accountType: 'player', freeTrialEndsAt: end, subscription: null }, now)).toBeNull()
    expect(trialEndsAt({ accountType: 'coach', freeTrialEndsAt: end, clubMembership: { id: 1 }, subscription: null }, now)).toBeNull()
  })

  it('GET /admin/users passes the filters, returns trialEndsAt and the trial-ending count', async () => {
    const end = new Date(Date.now() + 3 * 86_400_000)
    dbMock.user.findMany.mockResolvedValue([
      { id: 9, name: 'Ana', accountType: 'coach', freeTrialEndsAt: end, clubMembership: null, subscription: null, createdAt: new Date() },
    ] as never)
    dbMock.user.count.mockResolvedValueOnce(1 as never).mockResolvedValueOnce(4 as never)
    const res = await call('GET', '/api/admin/users?plan=trial_ending&type=coach&page=1')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.users[0].trialEndsAt).toBe(end.toISOString())
    expect(body.users[0]).not.toHaveProperty('clubMembership')
    expect(body.counts).toEqual({ trialEnding: 4 })
    const where = JSON.stringify(dbMock.user.findMany.mock.calls[0][0]?.where)
    expect(where).toContain('"accountType":"coach"')
    expect(where).toContain('freeTrialEndsAt')
  })

  it('sort=trial_end puts the soonest first', async () => {
    const d = (n: number) => new Date(Date.now() + n * 86_400_000)
    dbMock.user.findMany.mockResolvedValue([
      { id: 1, accountType: 'coach', freeTrialEndsAt: d(6), clubMembership: null, subscription: null },
      { id: 2, accountType: 'coach', freeTrialEndsAt: d(1), clubMembership: null, subscription: null },
      { id: 3, accountType: 'coach', freeTrialEndsAt: null, clubMembership: null, subscription: { status: 'trial', expiresAt: d(3) } },
    ] as never)
    dbMock.user.count.mockResolvedValue(3 as never)
    const res = await call('GET', '/api/admin/users?plan=trial_ending&sort=trial_end')
    expect(res.json().users.map((u: { id: number }) => u.id)).toEqual([2, 3, 1])
  })
})
