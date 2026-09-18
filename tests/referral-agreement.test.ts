// Nobody refers anybody before they have agreed to the rules.
//
// The gate is on GET /referrals/me because that endpoint mints the referral
// code on first call. Returning early there means an unsigned account never
// gets a code at all — so the assertion that matters is not "the UI hides the
// link", it is "no code was ever created".

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { REFERRAL_AGREEMENT, REFERRAL_AGREEMENT_VERSION } from '../src/modules/referrals/referral-agreement.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const get = async (url: string) => {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: authHeaders(await accessToken()) })
}
/** A small but valid PNG data URL — a real signature, as far as the API sees. */
const SIGNATURE = `data:image/png;base64,${'A'.repeat(600)}`

const post = async (url: string, payload: unknown = { name: 'Ana Ruiz', signature: SIGNATURE }) => {
  const app = await getApp()
  return app.inject({ method: 'POST', url, headers: authHeaders(await accessToken()), payload })
}

/** Nobody has signed anything, and this account is not a partner. */
function unsigned() {
  mock.partner.findUnique.mockResolvedValue(null as never)
  mock.agreementAcceptance.findFirst.mockResolvedValue(null as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('before the terms are accepted', () => {
  it('returns the agreement instead of a summary', async () => {
    unsigned()
    const res = await get('/api/referrals/me')
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.agreementRequired).toBe(true)
    expect(body.agreement.version).toBe(REFERRAL_AGREEMENT_VERSION)
    expect(body.agreement.sections.length).toBeGreaterThan(0)
  })

  it('never even reaches the code-minting path', async () => {
    // The whole point. If a code existed, the link would work regardless of
    // what the screen chose to render.
    //
    // Asserted on the LOOKUP rather than on user.update, because a mocked
    // account that already has a code never reaches the update — so
    // "update was not called" passes even with the gate torn out. The lookup
    // is the first thing ensureReferralCode does, so it not happening is
    // proof the summary was never built.
    unsigned()
    await get('/api/referrals/me')
    expect(mock.user.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(mock.user.update).not.toHaveBeenCalled()
  })

  it('hands back no code or link for the client to leak', async () => {
    unsigned()
    const body = (await get('/api/referrals/me')).json()
    expect(body.code).toBeUndefined()
    expect(body.link).toBeUndefined()
  })
})

describe('accepting', () => {
  it('records the version and the IP, and opens the programme', async () => {
    unsigned()
    mock.agreementAcceptance.upsert.mockResolvedValue({ signedAt: new Date() } as never)
    // getReferralSummary runs immediately afterwards.
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ANA-4K2XQ', name: 'Ana' } as never)
    mock.referral.findMany.mockResolvedValue([] as never)
    mock.referralReward.findMany.mockResolvedValue([] as never)
    mock.referral.groupBy.mockResolvedValue([] as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)

    const res = await post('/api/referrals/accept')
    expect(res.statusCode).toBe(200)

    const args = mock.agreementAcceptance.upsert.mock.calls[0][0] as {
      create: { kind: string; version: string; ip: string | null }
    }
    expect(args.create.kind).toBe('referral')
    expect(args.create.version).toBe(REFERRAL_AGREEMENT_VERSION)
    expect(args.create).toHaveProperty('ip')
  })

  it('is idempotent — a double click is not two agreements', async () => {
    // Enforced by the unique key and an empty update, so the FIRST signature
    // date survives rather than being quietly moved by a repeat post.
    unsigned()
    mock.agreementAcceptance.upsert.mockResolvedValue({ signedAt: new Date() } as never)
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ANA-4K2XQ', name: 'Ana' } as never)
    mock.referral.findMany.mockResolvedValue([] as never)
    mock.referralReward.findMany.mockResolvedValue([] as never)
    mock.referral.groupBy.mockResolvedValue([] as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)

    await post('/api/referrals/accept')
    const args = mock.agreementAcceptance.upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    expect(args.update).toEqual({})
  })
})

describe('after the terms are accepted', () => {
  it('returns the code and the ladders', async () => {
    mock.partner.findUnique.mockResolvedValue(null as never)
    mock.agreementAcceptance.findFirst.mockResolvedValue({ signedAt: new Date() } as never)
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ANA-4K2XQ', name: 'Ana' } as never)
    mock.referral.findMany.mockResolvedValue([] as never)
    mock.referralReward.findMany.mockResolvedValue([] as never)
    mock.referral.groupBy.mockResolvedValue([] as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)

    const body = (await get('/api/referrals/me')).json()
    expect(body.agreementRequired).toBe(false)
    expect(body.code).toBe('ANA-4K2XQ')
    expect(body.link).toContain('ANA-4K2XQ')
  })

  it('checks the CURRENT version, not any signature ever given', async () => {
    // Somebody who signed 1.0 has not agreed to 1.1. Treating them as though
    // they had is precisely what the version column exists to prevent.
    mock.partner.findUnique.mockResolvedValue(null as never)
    mock.agreementAcceptance.findFirst.mockResolvedValue(null as never)
    await get('/api/referrals/me')

    const where = mock.agreementAcceptance.findFirst.mock.calls[0][0]!.where
    expect(where.version).toBe(REFERRAL_AGREEMENT_VERSION)
    expect(where.kind).toBe('referral')
  })
})

describe('partners are not asked twice', () => {
  it('skips the referral terms for an active partner', async () => {
    // Their own agreement covers referrals in far more detail, and they signed
    // it to become a partner. Asking them to accept a second, weaker set of
    // terms for the same activity would be contradictory.
    mock.partner.findUnique.mockResolvedValue({ status: 'active' } as never)
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ANA-4K2XQ', name: 'Ana' } as never)
    mock.referral.findMany.mockResolvedValue([] as never)
    mock.referralReward.findMany.mockResolvedValue([] as never)
    mock.referral.groupBy.mockResolvedValue([] as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)

    const body = (await get('/api/referrals/me')).json()
    expect(body.agreementRequired).toBe(false)
    expect(mock.agreementAcceptance.findFirst).not.toHaveBeenCalled()
  })

  it('still asks someone who was only INVITED as a partner', async () => {
    // Invited is not signed. They have agreed to nothing yet, so the ordinary
    // referral terms still apply until they accept one document or the other.
    mock.partner.findUnique.mockResolvedValue({ status: 'invited' } as never)
    mock.agreementAcceptance.findFirst.mockResolvedValue(null as never)

    const body = (await get('/api/referrals/me')).json()
    expect(body.agreementRequired).toBe(true)
  })
})

describe('the document itself', () => {
  it('is served with a version', async () => {
    const body = (await get('/api/referrals/agreement')).json()
    expect(body.version).toBe(REFERRAL_AGREEMENT_VERSION)
    expect(body.title).toMatch(/referral/i)
  })

  it('quotes no ladder figures, which would drift out of step', () => {
    // The numbers live in lib/referral-ladder and differ across six ladders.
    // Copying any of them into the contract is how the partner agreement came
    // to promise 20% while the system paid 15%.
    const text = [
      ...REFERRAL_AGREEMENT.intro,
      ...REFERRAL_AGREEMENT.sections.flatMap((s) => [...(s.body ?? []), ...(s.points ?? [])]),
    ].join(' ')
    expect(text).not.toMatch(/\b\d+\s*(free\s*)?months?\b/i)
    expect(text).not.toMatch(/\d+%/)
  })

  it('tells people where the real numbers are', () => {
    const text = REFERRAL_AGREEMENT.sections.flatMap((s) => s.body ?? []).join(' ')
    expect(text).toMatch(/referrals page/i)
  })
})

describe('a signature is required, not a tick box', () => {
  beforeEach(() => {
    mock.partner.findUnique.mockResolvedValue(null as never)
    mock.agreementAcceptance.findFirst.mockResolvedValue(null as never)
    mock.agreementAcceptance.upsert.mockResolvedValue({ signedAt: new Date() } as never)
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ANA-4K2XQ', name: 'Ana' } as never)
    mock.referral.findMany.mockResolvedValue([] as never)
    mock.referralReward.findMany.mockResolvedValue([] as never)
    mock.referral.groupBy.mockResolvedValue([] as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)
  })

  it('refuses an acceptance with no name', async () => {
    const res = await post('/api/referrals/accept', { signature: SIGNATURE })
    expect(res.statusCode).toBe(422)
    expect(mock.agreementAcceptance.upsert).not.toHaveBeenCalled()
  })

  it('refuses an acceptance with no signature', async () => {
    const res = await post('/api/referrals/accept', { name: 'Ana Ruiz' })
    expect(res.statusCode).toBe(422)
    expect(mock.agreementAcceptance.upsert).not.toHaveBeenCalled()
  })

  it('refuses something that is not a PNG', async () => {
    // Stored and later decoded into a PDF, so "is it actually an image" is
    // worth asking before it is written rather than when a document fails to
    // render two years later.
    const res = await post('/api/referrals/accept', {
      name: 'Ana Ruiz',
      signature: 'data:text/html;base64,PHNjcmlwdD4=',
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toMatch(/png/i)
  })

  it('refuses an empty canvas dressed up as a signature', async () => {
    const res = await post('/api/referrals/accept', {
      name: 'Ana Ruiz',
      signature: 'data:image/png;base64,AAAA',
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toMatch(/sign/i)
  })

  it('refuses an image far too large to be a signature', async () => {
    const res = await post('/api/referrals/accept', {
      name: 'Ana Ruiz',
      signature: `data:image/png;base64,${'A'.repeat(300_000)}`,
    })
    expect(res.statusCode).toBe(422)
  })

  it('stores the name the SIGNER typed, not their account name', async () => {
    // A club secretary signing for the club, or somebody whose account says
    // "Vince" but who signs "Vincent Okafor".
    await post('/api/referrals/accept', { name: 'Vincent Okafor', signature: SIGNATURE })
    const args = mock.agreementAcceptance.upsert.mock.calls[0][0] as {
      create: { signerName: string; signature: string }
    }
    expect(args.create.signerName).toBe('Vincent Okafor')
    expect(args.create.signature).toBe(SIGNATURE)
  })

  it('refuses a name in a script the PDF cannot draw', async () => {
    const res = await post('/api/referrals/accept', { name: '田中太郎', signature: SIGNATURE })
    expect(res.statusCode).toBe(422)
  })
})
