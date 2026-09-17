// Leads — adding one by hand, and importing a spreadsheet.
//
// The rule worth breaking a build over is the import's arithmetic: every row
// somebody sends has to come back accounted for. An importer that silently
// drops rows is one nobody trusts a second time, and "did it work?" then costs
// more than typing the list in would have.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { isMailConfigured } from '../src/config/mailer.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** The owner, answered for whichever lookup asks who is calling. */
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

const post = async (url: string, payload: unknown) => {
  const app = await getApp()
  return app.inject({ method: 'POST', url, headers: authHeaders(await accessToken()), payload })
}

beforeEach(() => {
  vi.clearAllMocks()
  asOwner()
})

describe('adding a lead by hand', () => {
  it('stores it as `direct` with no message', async () => {
    // A hand-added lead has not written to us. message must be NULL rather
    // than '', which would show up in the inbox as an empty message from a
    // person who never sent one.
    mock.contactMessage.findFirst.mockResolvedValue(null as never)
    mock.contactMessage.create.mockResolvedValue({ id: 5 } as never)

    const res = await post('/api/admin/leads', {
      firstName: 'Hikmet', lastName: 'Karaman', email: ' Hiksel@Hotmail.com ', kind: 'coach',
    })
    expect(res.statusCode).toBe(201)

    const data = mock.contactMessage.create.mock.calls[0][0].data
    expect(data.source).toBe('direct')
    expect(data.kind).toBe('coach')
    expect(data.message).toBeNull()
    // Trimmed and lower-cased, or the same person arrives twice with
    // different capitalisation and dedupe never fires.
    expect(data.email).toBe('hiksel@hotmail.com')
  })

  it('warns about a duplicate instead of refusing it', async () => {
    // The same person legitimately appears twice — they used the contact form
    // in March and you met them in September. Throwing the second one away
    // loses the newer, better context; the answer is to say so.
    mock.contactMessage.findFirst.mockResolvedValue({ id: 2, source: 'web', createdAt: new Date() } as never)
    mock.contactMessage.create.mockResolvedValue({ id: 6 } as never)

    const res = await post('/api/admin/leads', { firstName: 'A', email: 'a@t.dev' })
    expect(res.statusCode).toBe(201)
    expect(res.json().duplicateOf.id).toBe(2)
    expect(mock.contactMessage.create).toHaveBeenCalled()
  })

  it('refuses an address that is not an address', async () => {
    const res = await post('/api/admin/leads', { firstName: 'A', email: 'not-an-email' })
    expect(res.statusCode).toBe(422)
    expect(mock.contactMessage.create).not.toHaveBeenCalled()
  })
})

describe('importing a spreadsheet', () => {
  const row = (email: string, extra: Record<string, unknown> = {}) => ({
    firstName: 'Test', lastName: 'Coach', email, ...extra,
  })

  it('accounts for every row it was sent', async () => {
    // received == imported + alreadyOnFile + duplicateInFile + invalid.
    // This is the assertion that makes the report trustworthy.
    mock.contactMessage.findMany.mockResolvedValue([{ email: 'known@t.dev' }] as never)
    mock.contactMessage.createMany.mockResolvedValue({ count: 2 } as never)

    const res = await post('/api/admin/leads/import', {
      rows: [
        row('new1@t.dev'),
        row('new2@t.dev'),
        row('known@t.dev'),        // already in the database
        row('new1@t.dev'),         // repeated inside the file
        row('broken'),             // not an email
        { lastName: 'NoFirstName', email: 'x@t.dev' }, // missing required field
      ],
    })
    expect(res.statusCode).toBe(200)
    const r = res.json()

    expect(r.received).toBe(6)
    expect(r.imported).toBe(2)
    expect(r.alreadyOnFile).toEqual(['known@t.dev'])
    expect(r.duplicateInFile).toEqual(['new1@t.dev'])
    expect(r.invalid).toHaveLength(2)

    expect(r.imported + r.alreadyOnFile.length + r.duplicateInFile.length + r.invalid.length)
      .toBe(r.received)
  })

  it('reports the row number the person can see on their screen', async () => {
    // Their spreadsheet has a header row and counts from 1. Saying "row 0"
    // when the screen says "row 2" makes the report useless.
    mock.contactMessage.findMany.mockResolvedValue([] as never)
    mock.contactMessage.createMany.mockResolvedValue({ count: 0 } as never)

    const res = await post('/api/admin/leads/import', { rows: [row('broken')] })
    expect(res.json().invalid[0].row).toBe(2)
  })

  it('marks imported rows as `import`, never as a contact-form message', async () => {
    mock.contactMessage.findMany.mockResolvedValue([] as never)
    mock.contactMessage.createMany.mockResolvedValue({ count: 1 } as never)

    await post('/api/admin/leads/import', { rows: [row('a@t.dev', { kind: 'club' })] })
    const data = mock.contactMessage.createMany.mock.calls[0][0].data
    expect(data[0].source).toBe('import')
    expect(data[0].kind).toBe('club')
    expect(data[0].message).toBeNull()
  })

  it('writes nothing when every row is already on file', async () => {
    mock.contactMessage.findMany.mockResolvedValue([{ email: 'known@t.dev' }] as never)

    const res = await post('/api/admin/leads/import', { rows: [row('known@t.dev')] })
    expect(res.json().imported).toBe(0)
    expect(mock.contactMessage.createMany).not.toHaveBeenCalled()
  })

  it('refuses a file too large to be a list a human made', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(`u${i}@t.dev`))
    const res = await post('/api/admin/leads/import', { rows })
    expect(res.statusCode).toBe(422)
  })
})

describe('the contact form still works', () => {
  it('lands as a `web` lead, with the message kept', async () => {
    // The whole point of extending this table rather than adding a second one
    // is that the contact form keeps filling the same list. If this breaks,
    // the inbox silently stops receiving.
    const app = await getApp()
    // The route answers 503 when SMTP is unconfigured, which is the default in
    // tests — it refuses to accept a message it cannot forward.
    vi.mocked(isMailConfigured).mockReturnValue(true)
    mock.contactMessage.create.mockResolvedValue({ id: 9 } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/contact',
      payload: {
        first_name: 'Vince', last_name: 'Coach', email: 'vince@t.dev',
        message: 'Hello, I have a question about the club plan.',
      },
    })
    expect(res.statusCode).toBe(200)

    const data = mock.contactMessage.create.mock.calls[0][0].data
    expect(data.message).toContain('club plan')
    // `web` comes from the column default rather than being written here, so
    // the absence of an explicit source is the correct outcome.
    expect(data.source).toBeUndefined()
  })
})
