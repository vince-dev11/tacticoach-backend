// The note email and the guardian link it carries.
//
// This email is now the whole player proposition: players are free, nobody is
// asked to subscribe, and this is the thing that arrives in their inbox after
// a session. If it is wrong, there is no product left for a player.
//
// tests/setup.ts mocks the mailer globally, so the assertions here are about
// what is HANDED to sendMail rather than what SMTP does with it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const SESSION_DATE = new Date('2026-09-15T18:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockResolvedValue(undefined)
})

afterEach(() => {
  mailConfigured.mockReturnValue(false)
})

/**
 * One pending note for a linked player, plus whatever history the digest
 * should find. `history` is what playerNote.findMany returns on its SECOND
 * call — the digest sweep — so a test can say "this is their fourth note".
 */
function mockSend(options: {
  guardianEmail?: string | null
  boardId?: number | null
  body?: string
  strengths?: string[]
  workOns?: string[]
  history?: { strengths: string[]; workOns: string[] }[]
} = {}) {
  const note = {
    id: 900,
    body: options.body ?? 'Really good half an hour from you tonight.',
    strengths: options.strengths ?? ['first_touch', 'scanning'],
    workOns: options.workOns ?? ['weak_foot'],
    boardId: options.boardId ?? null,
    squadPlayerId: 55,
    squadPlayer: {
      id: 55,
      name: 'Nathan',
      guardianEmail: options.guardianEmail ?? null,
      linkStatus: 'active',
      playerUser: { id: 42, name: 'Nathan', email: 'nathan@test.dev' },
    },
    session: { title: 'Pressing triggers', sessionDate: SESSION_DATE },
  }

  const history = (options.history ?? [{ strengths: ['first_touch', 'scanning'], workOns: ['weak_foot'] }])
    .map((h) => ({ squadPlayerId: 55, ...h }))

  mock.playerNote.findMany
    .mockResolvedValueOnce([note] as never) // the pending sweep
    .mockResolvedValueOnce(history as never) // the digest sweep
  mock.playerNote.updateMany.mockResolvedValue({ count: 1 } as never)

  // Entitlements: an ordinary paying coach.
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.partner.findUnique.mockResolvedValue(null)
  mock.squadPlayer.findFirst.mockResolvedValue(null as never)
  dbMock.user.findUnique.mockResolvedValue(
    userRow({ name: 'Marco', surname: 'Rossi', clubName: 'FC Test' }) as never,
  )
  return note
}

async function send() {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST',
    url: '/api/feedback/sessions/12/send',
    headers: authHeaders(await accessToken()),
  })
  expect(res.statusCode).toBe(200)
  await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalled())
  return sendMailMock.mock.calls[0][0]
}

describe('the note email is a report, not a notification', () => {
  it('carries the coach, the club and the session in the subject and body', async () => {
    mockSend()
    const mail = await send()

    expect(mail.to).toBe('nathan@test.dev')
    expect(mail.subject).toBe('Marco Rossi on Pressing triggers')
    expect(mail.html).toContain('Marco Rossi')
    expect(mail.html).toContain('FC Test')
    expect(mail.html).toContain('Pressing triggers')
  })

  it('includes the note in full — the whole point is not making them log in', async () => {
    mockSend({ body: 'Best you have played all season.' })
    const mail = await send()
    expect(mail.html).toContain('Best you have played all season.')
    expect(mail.text).toContain('Best you have played all season.')
  })

  it('prints tag LABELS, never the raw keys', async () => {
    mockSend()
    const mail = await send()
    expect(mail.html).toContain('First touch')
    expect(mail.html).toContain('Scanning')
    expect(mail.html).toContain('Weak foot')
    expect(mail.html).not.toContain('first_touch')
    expect(mail.text).not.toContain('weak_foot')
  })

  it('links the board when the coach attached one, and not when they did not', async () => {
    mockSend({ boardId: 77 })
    expect((await send()).html).toContain('/share/board/77')

    sendMailMock.mockClear()
    mockSend({ boardId: null })
    expect((await send()).html).not.toContain('/share/board/')
  })

  it('always offers the season, which is the only thing we ask them to open', async () => {
    mockSend()
    const mail = await send()
    expect(mail.html).toContain('/my-football')
    expect(mail.text).toContain('/my-football')
  })
})

describe('the season digest', () => {
  it('calls a first note a first note rather than "your 1st"', async () => {
    mockSend({ history: [{ strengths: [], workOns: [] }] })
    const mail = await send()
    expect(mail.text).toContain('This is the first note from your coach.')
    expect(mail.text).not.toContain('1st note')
  })

  it('counts the note being sent — an off-by-one here is visible to a child', async () => {
    // Four sent rows exist AFTER this one was marked sent, so it is the 4th.
    mockSend({
      history: [
        { strengths: ['scanning'], workOns: [] },
        { strengths: ['scanning'], workOns: [] },
        { strengths: ['scanning'], workOns: ['weak_foot'] },
        { strengths: ['first_touch'], workOns: [] },
      ],
    })
    const mail = await send()
    expect(mail.text).toContain('your 4th note this season')
    expect(mail.html).toContain('Scanning')
  })

  it('stays quiet about "mentioned most" until there is a pattern to report', async () => {
    // Two notes is not a pattern. Showing "Scanning ×1" as a headline
    // statistic is what makes a thoughtful feature look automated.
    mockSend({ history: [{ strengths: ['scanning'], workOns: [] }, { strengths: ['scanning'], workOns: [] }] })
    const mail = await send()
    expect(mail.text).not.toContain('Mentioned most')
    expect(mail.html).not.toContain('YOUR SEASON SO FAR')
  })
})

describe('the guardian copy', () => {
  it('copies the guardian and offers them the standing link', async () => {
    mockSend({ guardianEmail: 'parent@test.dev' })
    const mail = await send()
    expect(mail.to).toBe('nathan@test.dev, parent@test.dev')
    expect(mail.html).toContain('/guardian/')
    expect(mail.html).toContain('no account needed')
  })

  it('offers no guardian link when no guardian address is set', async () => {
    mockSend({ guardianEmail: null })
    const mail = await send()
    expect(mail.html).not.toContain('/guardian/')
  })

  it('signs the SQUAD ROW id, not the note id', async () => {
    // The regression this pins: the token used to carry note.id while the
    // guardian route looked it up as a squadPlayer id. A parent's link then
    // resolved to a different child's record or to nothing at all. The two
    // ids are deliberately different numbers in mockSend (900 vs 55).
    const app = await getApp()
    mockSend({ guardianEmail: 'parent@test.dev' })
    const mail = await send()

    const token = /\/guardian\/([\w.-]+)/.exec(mail.html)?.[1]
    expect(token).toBeTruthy()
    const payload = app.jwt.verify(token!) as { sub: number; type: string }
    expect(payload.type).toBe('guardian')
    expect(payload.sub).toBe(55)
  })
})

describe('the guardian route is actually public', () => {
  // The regression: this route was registered ABOVE
  // `app.addHook('preHandler', authGuard)` with a comment saying that kept it
  // open. Fastify scopes hooks to the encapsulation context, not to the lines
  // after the call, so the route a parent opens from their inbox — the one
  // reader who by definition has no login — answered 401.
  //
  // A 401 for an unauthenticated caller is exactly what a passing auth guard
  // looks like, so asserting "not 401" is the assertion that matters.

  it('answers a garbage token with 404, never 401', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/feedback/guardian/not-a-jwt' })
    expect(res.statusCode).not.toBe(401)
    expect(res.statusCode).toBe(404)
  })

  it('accepts a token longer than Fastify\'s default parameter limit', async () => {
    // The third guardian bug, and the one that made the other two academic:
    // Fastify caps a single path parameter at 100 characters and answers 414
    // in the ROUTER, before any handler runs. A signed JWT is 200-400. So
    // every guardian link ever emailed died in the router with no log line.
    //
    // Asserted on length rather than on the fix, so this keeps failing if
    // somebody removes maxParamLength from buildApp.
    const app = await getApp()
    const token = app.jwt.sign({ sub: 55, type: 'guardian' })
    expect(token.length).toBeGreaterThan(100)

    mock.squadPlayer.findFirst.mockResolvedValue(null as never)
    const res = await app.inject({ method: 'GET', url: `/api/feedback/guardian/${token}` })
    expect(res.statusCode).not.toBe(414)
  })

  it('refuses a valid token of the wrong type without asking for a login', async () => {
    const app = await getApp()
    // A real access token is signed by the same key. Type is what separates
    // "may read one child's notes" from "is logged in".
    const res = await app.inject({
      method: 'GET',
      url: `/api/feedback/guardian/${await accessToken()}`,
    })
    expect(res.statusCode).toBe(404)
  })

  it('serves the record for a good token, with no Authorization header', async () => {
    const app = await getApp()
    mock.squadPlayer.findFirst.mockResolvedValue({
      name: 'Nathan',
      number: '7',
      user: { name: 'Marco', surname: 'Rossi', clubName: 'FC Test' },
      notes: [],
    } as never)

    const token = app.jwt.sign({ sub: 55, type: 'guardian' })
    const res = await app.inject({ method: 'GET', url: `/api/feedback/guardian/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Nathan')

    // Revocation is "the guardian address was cleared", not token expiry.
    const where = mock.squadPlayer.findFirst.mock.calls[0][0]!.where
    expect(where.id).toBe(55)
    expect(where.guardianEmail).toEqual({ not: null })
  })
})

describe('safety of what a coach typed', () => {
  it('escapes HTML in the note before it reaches a child and their parent', async () => {
    mockSend({ body: 'Great <b>work</b> & keep going' })
    const mail = await send()
    expect(mail.html).toContain('Great &lt;b&gt;work&lt;/b&gt; &amp; keep going')
    expect(mail.html).not.toContain('Great <b>work</b>')
    // The plain-text alternative is not HTML and must stay readable.
    expect(mail.text).toContain('Great <b>work</b> & keep going')
  })
})
