// Admin → Referrals: who has signed the referral terms, and who has not.
//
// The gate itself is covered in referral-agreement.test.ts — an unsigned
// account never even reaches the code-minting path. This file covers the
// OVERVIEW, and the thing it has to get right is that "signed" is not a
// boolean.
//
// The gate is version-specific: somebody who accepted an earlier version is
// back behind it and cannot see their own link. An admin screen that showed
// them as signed would hide the one state it exists to surface, so `outdated`
// is asserted here as its own thing rather than folded into either side.

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { REFERRAL_AGREEMENT_VERSION } from '../src/modules/referrals/referral-agreement.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof import('vitest').vi.fn>>>

/** The caller is the owner; nobody else may read this. */
function ownerRole() {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    if (select?.accountType && !select.email) return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    if (select?.role) return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    return Promise.resolve(null as never)
  })
}

const coach = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  surname: 'Coach',
  email: `${name.toLowerCase()}@club.test`,
  clubName: null,
  createdAt: new Date('2026-01-01'),
  referralCode: null,
  subscription: { plan: { name: 'Pro', slug: 'pro' } },
  collaborator: null,
  _count: { referralsMade: 0 },
  ...extra,
})

const acceptance = (userId: number, version: string) => ({
  userId,
  version,
  signerName: 'Signed Name',
  signedAt: new Date('2026-02-02'),
})

/**
 * Wire up the three queries the route makes.
 *
 * `people` is the page, `everyone` is the population the counts are taken
 * over, and `signatures` is every acceptance row across both.
 */
function scenario(opts: {
  people: ReturnType<typeof coach>[]
  everyone?: { id: number }[]
  signatures?: ReturnType<typeof acceptance>[]
  activeCollaborators?: number[]
}) {
  const everyone = opts.everyone ?? opts.people.map((p) => ({ id: p.id }))
  let call = 0
  mock.user.findMany.mockImplementation(() => {
    // First call is the page (it selects the whole row), second is the
    // population for the counts (ids only).
    call += 1
    return Promise.resolve((call === 1 ? opts.people : everyone) as never)
  })
  mock.user.count.mockResolvedValue(opts.people.length as never)
  mock.agreementAcceptance.findMany.mockResolvedValue((opts.signatures ?? []) as never)
  mock.collaborator.findMany.mockResolvedValue(
    (opts.activeCollaborators ?? []).map((userId) => ({ userId })) as never,
  )
}

const get = async (qs = '') => {
  const app = await getApp()
  return app.inject({
    method: 'GET',
    url: `/api/admin/referrals/signatures${qs}`,
    headers: authHeaders(await accessToken()),
  })
}

describe('who may read it', () => {
  it('refuses a coach', async () => {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const select = (args as { select?: Record<string, unknown> } | undefined)?.select
      if (select?.accountType || select?.role) {
        return Promise.resolve({ role: 'user', accountType: 'coach' } as never)
      }
      return Promise.resolve(null as never)
    })
    expect((await get()).statusCode).toBe(403)
  })
})

describe('the four states', () => {
  it('calls somebody on the current version signed', async () => {
    ownerRole()
    scenario({
      people: [coach(1, 'Priya', { referralCode: 'PRIYA-4K2XQ' })],
      signatures: [acceptance(1, REFERRAL_AGREEMENT_VERSION)],
    })

    const body = (await get()).json()
    expect(body.rows[0]).toMatchObject({
      status: 'current',
      version: REFERRAL_AGREEMENT_VERSION,
      hasCode: true,
    })
  })

  it('calls somebody on an OLD version outdated, not signed', async () => {
    // The state this screen exists for. They accepted something, so a boolean
    // would read "signed" — but the gate asks for the current version, so they
    // cannot see their own link right now.
    ownerRole()
    scenario({ people: [coach(2, 'Tom')], signatures: [acceptance(2, '0.9-historic')] })

    const body = (await get()).json()
    expect(body.rows[0].status).toBe('outdated')
    expect(body.rows[0].version).toBe('0.9-historic')
  })

  it('calls somebody who never signed not signed', async () => {
    ownerRole()
    scenario({ people: [coach(3, 'Ana')] })

    const body = (await get()).json()
    expect(body.rows[0]).toMatchObject({ status: 'none', version: null, signedAt: null })
  })

  it('calls an active collaborator exempt rather than unsigned', async () => {
    // Their own agreement covers referrals in more detail and they signed it
    // to become a collaborator. Listing them as "not signed" would put a permanent
    // row on a list whose whole purpose is to get shorter.
    ownerRole()
    scenario({
      people: [coach(4, 'Sam', { collaborator: { status: 'active' } })],
      activeCollaborators: [4],
    })

    expect((await get()).json().rows[0].status).toBe('exempt')
  })

  it('still asks somebody only INVITED as a collaborator', async () => {
    // Invited is not active: no commission accrues and nothing is comped, so
    // the referral terms still apply to them.
    ownerRole()
    scenario({ people: [coach(5, 'Lee', { collaborator: { status: 'invited' } })] })

    expect((await get()).json().rows[0].status).toBe('none')
  })

  it('reports the newest version when somebody signed twice', async () => {
    // A coach who accepted an old version and then the current one is current.
    // The helper walks oldest-first so the newest write wins; if that ordering
    // ever flips, this is what notices.
    ownerRole()
    scenario({
      people: [coach(6, 'Mo')],
      signatures: [acceptance(6, '0.9-historic'), acceptance(6, REFERRAL_AGREEMENT_VERSION)],
    })

    expect((await get()).json().rows[0].status).toBe('current')
  })
})

describe('the counts', () => {
  it('counts every state over the whole population', async () => {
    ownerRole()
    scenario({
      people: [coach(1, 'Priya')],
      everyone: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      signatures: [acceptance(1, REFERRAL_AGREEMENT_VERSION), acceptance(2, '0.9-historic')],
      activeCollaborators: [4],
    })

    expect((await get()).json().counts).toEqual({
      current: 1,
      outdated: 1,
      none: 1,
      exempt: 1,
    })
  })

  it('does not narrow the counts when somebody searches', async () => {
    // A "not signed: 175" that became "not signed: 2" because you typed a name
    // is worse than no number at all — it answers a different question from
    // the one it appears to answer.
    ownerRole()
    scenario({
      people: [coach(1, 'Priya')],
      everyone: [{ id: 1 }, { id: 2 }, { id: 3 }],
      signatures: [acceptance(1, REFERRAL_AGREEMENT_VERSION)],
    })

    const body = (await get('?search=priya')).json()
    expect(body.rows).toHaveLength(1)
    expect(body.counts.current + body.counts.outdated + body.counts.none + body.counts.exempt).toBe(3)

    // …and the population query must not have carried the search term.
    const populationCall = mock.user.findMany.mock.calls[1]![0] as { where: Record<string, unknown> }
    expect(populationCall.where).not.toHaveProperty('OR')
  })
})

describe('the state filter', () => {
  // It has to run in the QUERY, not over the page. Filtering the 25 rows we
  // happened to fetch would give a page of eight and a pager still claiming
  // nine pages — and "show me everyone who hasn't signed" is the one path that
  // must not be subtly wrong.
  const whereOf = () => (mock.user.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where

  it('asks the database for the unsigned, rather than filtering a page', async () => {
    ownerRole()
    scenario({ people: [] })
    await get('?state=none')

    expect(whereOf()).toMatchObject({
      NOT: { agreements: { some: { kind: 'referral' } } },
    })
  })

  it('asks for signed-something-but-not-current when filtering outdated', async () => {
    ownerRole()
    scenario({ people: [] })
    await get('?state=outdated')

    expect(whereOf()).toMatchObject({
      agreements: { some: { kind: 'referral' } },
      NOT: { agreements: { some: { kind: 'referral', version: REFERRAL_AGREEMENT_VERSION } } },
    })
  })

  it('asks for the current version when filtering signed', async () => {
    ownerRole()
    scenario({ people: [] })
    await get('?state=current')

    expect(whereOf()).toMatchObject({
      agreements: { some: { kind: 'referral', version: REFERRAL_AGREEMENT_VERSION } },
    })
  })

  it('adds no state condition for "all", and ignores a nonsense one', async () => {
    ownerRole()
    scenario({ people: [] })
    await get('?state=all')
    expect(whereOf()).not.toHaveProperty('agreements')

    mock.user.findMany.mockClear()
    scenario({ people: [] })
    await get('?state=nonsense')
    // An unknown filter must widen to everyone rather than silently matching
    // nothing — an empty table reads as "nobody is unsigned", which is the
    // most dangerous wrong answer this screen could give.
    expect(whereOf()).not.toHaveProperty('agreements')
  })

  it('leaves players out entirely', async () => {
    // The player plan is retired and players cannot refer anybody, so listing
    // them would pad "not signed" with accounts that will never sign.
    ownerRole()
    scenario({ people: [] })
    await get()
    expect(whereOf()).toMatchObject({ accountType: { not: 'player' } })
  })
})

describe('what it does not leak', () => {
  it('never returns the signature image', async () => {
    // It is drawn into the PDF and nowhere else. Shipping a few hundred
    // kilobytes of base64 per row to render a date is waste, and it puts
    // somebody's signature into a JSON response that did not need it.
    ownerRole()
    scenario({
      people: [coach(1, 'Priya')],
      signatures: [acceptance(1, REFERRAL_AGREEMENT_VERSION)],
    })

    const body = (await get()).payload
    expect(body).not.toContain('signature')
    expect(body).not.toContain('data:image')

    const select = (mock.agreementAcceptance.findMany.mock.calls[0]![0] as {
      select: Record<string, unknown>
    }).select
    expect(select).not.toHaveProperty('signature')
  })

  it('tells the client which version the gate is asking for', async () => {
    // So "on v1.0 — needs v2.0" can be rendered without the frontend keeping
    // its own copy of the current version, which would drift the first time
    // the terms were bumped.
    ownerRole()
    scenario({ people: [] })
    expect((await get()).json().currentVersion).toBe(REFERRAL_AGREEMENT_VERSION)
  })
})
