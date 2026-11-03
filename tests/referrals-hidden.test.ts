// REFERRALS-HIDDEN (owner, 3 Nov 2026): the referral programme is put away
// for now. With REFERRALS_ENABLED=false the programme's routes answer 404
// `referrals_off`, a referral code on register is dropped, and the
// collaboration routes that share the /api/referrals prefix carry on.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { env } from '../src/config/env.js'
import { attachReferral } from '../src/modules/referrals/referrals.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const flag = env as unknown as { REFERRALS_ENABLED: boolean }

describe('REFERRALS-HIDDEN', () => {
  beforeEach(() => { flag.REFERRALS_ENABLED = false })
  afterAll(() => { flag.REFERRALS_ENABLED = true })

  it('lookup, me, agreement and accept answer 404 referrals_off', async () => {
    const app = await getApp()
    const h = authHeaders(await accessToken())
    for (const [method, url] of [
      ['GET', '/api/referrals/lookup?code=ABC123'],
      ['GET', '/api/referrals/me'],
      ['GET', '/api/referrals/agreement'],
      ['POST', '/api/referrals/accept'],
    ] as const) {
      const res = await app.inject({ method, url, headers: h, ...(method === 'POST' ? { payload: { name: 'Ana Ruiz', signature: 'x' } } : {}) })
      expect(res.statusCode, `${method} ${url}`).toBe(404)
      expect(res.json().error).toBe('referrals_off')
    }
  })

  it('a referral code on register is dropped — nothing is recorded', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 7 } as never)
    await attachReferral(99, 'ABC123')
    expect(mock.referral.create).not.toHaveBeenCalled()
    flag.REFERRALS_ENABLED = true
    mock.referral.create.mockResolvedValue({} as never)
    await attachReferral(99, 'ABC123')
    expect(mock.referral.create).toHaveBeenCalledTimes(1)
  })

  it('the collaboration statement under the same prefix is not switched off', async () => {
    const app = await getApp()
    mock.collaborator.findUnique.mockResolvedValue(null as never)
    const res = await app.inject({ method: 'GET', url: '/api/referrals/collaboration', headers: authHeaders(await accessToken()) })
    // A non-collaborator gets the route's own "not a collaborator" 404 — not the programme switch.
    expect(res.json().error).not.toBe('referrals_off')
  })
})
