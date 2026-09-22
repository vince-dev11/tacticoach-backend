// A player account may reach the player product and nothing else.
//
// The requirement is "if a player types a coach URL, it must not work" — so
// these are route-level assertions against the real app, not unit tests of a
// predicate. A predicate that says no while the router says yes is worth
// nothing.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import { playerMayCall } from '../src/lib/player-lockdown.js'
import { getEntitlements } from '../src/lib/entitlements.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** Answer "who is asking?" with an account of the given type. */
function callerIs(accountType: 'coach' | 'club' | 'player', role = 'user') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role, accountType } as never)
    }
    return Promise.resolve({ id: 1, role, accountType } as never)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Every coach-product surface, by module. A player typing any of these into
// the address bar is the exact scenario being defended against.
const COACH_ROUTES: [string, string, string][] = [
  ['GET', '/api/canvas/boards', 'tactics boards'],
  ['POST', '/api/canvas/boards', 'creating a board'],
  ['GET', '/api/canvas/library', 'the board library'],
  ['GET', '/api/drill-sheets', 'drill sheets'],
  ['POST', '/api/drill-sheets', 'creating a drill sheet'],
  ['GET', '/api/drill-sheets/gallery', 'the drill sheet gallery'],
  ['GET', '/api/sessions', 'session builder'],
  ['POST', '/api/sessions', 'creating a session'],
  ['GET', '/api/plans', 'season planner'],
  ['POST', '/api/plans', 'creating a season plan'],
  ['GET', '/api/clubs/my', 'club administration'],
  ['POST', '/api/clubs/invites', 'inviting a coach'],
  ['GET', '/api/challenges/current', 'challenges'],
  ['GET', '/api/coach/me/branding', 'the coach public page'],
  ['GET', '/api/users/me/squad', 'a coach squad roster'],
  ['GET', '/api/users/me/squads', 'multiple squads'],
  ['GET', '/api/my-books', 'writing a book'],
  ['POST', '/api/my-books', 'starting a book'],
  ['GET', '/api/admin/blog', 'the admin area'],
  ['GET', '/api/referrals/lookup', 'the referral programme'],
  ['POST', '/api/membership/checkout', 'buying a coach plan'],
]

describe('a player is refused the coach product', () => {
  it('is guarding routes that actually exist', async () => {
    // Without this, the suite below proves nothing. The lockdown 403s any path
    // it does not recognise, so a typo in the table — or a route that was
    // renamed — would still "pass" as a 403 while testing a URL the router has
    // never heard of. A coach must at least get PAST routing on every one.
    const app = await getApp()
    for (const [method, url] of COACH_ROUTES) {
      callerIs('coach')
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: authHeaders(await accessToken()),
        ...(method === 'POST' ? { payload: {} } : {}),
      })
      expect(res.statusCode, `${method} ${url} does not exist`).not.toBe(404)
    }
  })

  for (const [method, url, what] of COACH_ROUTES) {
    it(`403s ${method} ${url} — ${what}`, async () => {
      const app = await getApp()
      callerIs('player')
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: authHeaders(await accessToken()),
        ...(method === 'POST' ? { payload: {} } : {}),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('PLAYER_ACCOUNT')
    })
  }

  it('does not invite them to buy their way out of it', async () => {
    // There is no plan that turns a player account into a coach one. Telling a
    // child "choose a plan to keep using the editor" — the entitlement guard's
    // message — would be both untrue and grubby.
    const app = await getApp()
    callerIs('player')
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/boards',
      headers: authHeaders(await accessToken()),
    })
    expect(res.json().message).not.toMatch(/plan|trial|upgrade|subscri/i)
  })
})

describe('a player keeps their own product', () => {
  it('reaches their feedback', async () => {
    const app = await getApp()
    callerIs('player')
    mock.squadPlayer.findMany.mockResolvedValue([] as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/feedback/links',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('reaches their own profile and entitlements', async () => {
    const app = await getApp()
    callerIs('player')
    mock.squadPlayer.findFirst.mockResolvedValue(null as never)

    for (const url of ['/api/users/me', '/api/membership/entitlements']) {
      const res = await app.inject({ method: 'GET', url, headers: authHeaders(await accessToken()) })
      expect(res.statusCode, url).toBe(200)
    }
  })
})

describe('coaches are unaffected', () => {
  it('lets a paying coach into the editor', async () => {
    const app = await getApp()
    callerIs('coach')
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.collaborator.findUnique.mockResolvedValue(null)
    mock.squadPlayer.findFirst.mockResolvedValue(null as never)
    mock.board.findMany.mockResolvedValue([] as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/boards',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).not.toBe(403)
  })
})

describe('entitlements refuse a player regardless of what they hold', () => {
  it('gives no editor access to a player on an active trial', async () => {
    // The hole this closes: registerUser gives EVERY new account a 7-day
    // full-access trial. A player's first week therefore had an active
    // subscription and `editorAccess: true`, and the whole coach product was
    // open to a child's account until it lapsed.
    callerIs('player')
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'trial' }) as never,
    )
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)
    dbMock.collaborator.findUnique.mockResolvedValue(null)
    mock.squadPlayer.findFirst.mockResolvedValue(null as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.plan).toBeNull()
  })

  it('still gives a linked player their own screens', async () => {
    callerIs('player')
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 3 } as never)
    expect((await getEntitlements(1)).playerAccess).toBe(true)
  })
})

describe('the allow-list itself', () => {
  it('does not let /api/clubs through on the /api/club prefix', async () => {
    // One character apart, opposite answers: /api/club/:slug is the public
    // club page, /api/clubs/* is seat and invite administration. A prefix
    // written without the trailing slash would have opened both.
    expect(playerMayCall('/api/club/riverside-fc')).toBe(true)
    expect(playerMayCall('/api/clubs/mine')).toBe(false)
    expect(playerMayCall('/api/clubs')).toBe(false)
  })

  it('does not let a coach squad route through on the /api/users/me match', () => {
    expect(playerMayCall('/api/users/me')).toBe(true)
    expect(playerMayCall('/api/users/me/squad')).toBe(false)
    expect(playerMayCall('/api/users/me/squads')).toBe(false)
    expect(playerMayCall('/api/users/me/logo')).toBe(false)
  })

  it('cannot be walked around with a trailing slash', () => {
    expect(playerMayCall('/api/users/me/')).toBe(true)
    expect(playerMayCall('/api/canvas/')).toBe(false)
  })

  it('allows reading billing but not buying', () => {
    expect(playerMayCall('/api/membership/entitlements')).toBe(true)
    expect(playerMayCall('/api/membership/checkout')).toBe(false)
  })

  it('denies anything it has never heard of — the point of an allow-list', () => {
    // A module added next month is closed to players until someone opens it
    // on purpose. The inverse shape (a deny-list) fails here.
    expect(playerMayCall('/api/some-feature-we-ship-in-march')).toBe(false)
  })
})
