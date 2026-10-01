// Contact form topics: what a message is about decides the admin inbox.
// Sales and club questions are Leads; everything else is Support.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'
import { boxFor, boxWhere, CONTACT_TOPICS, LEAD_TOPICS, SUPPORT_TOPICS } from '../src/modules/contact/topics.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)

const form = { first_name: 'Olly', last_name: 'P', email: 'olly@club.test', message: 'The export does not work on my iPad.' }

async function contact(extra: Record<string, unknown> = {}) {
  const app = await getApp()
  return app.inject({ method: 'POST', url: '/api/contact', payload: { ...form, ...extra } })
}

function asOwner() {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const keys = Object.keys((args as { select?: Record<string, unknown> } | undefined)?.select ?? {})
    if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    return Promise.resolve({ id: 1, role: 'owner', accountType: 'coach' } as never)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
  mock.contactMessage.findFirst.mockResolvedValue(null)
  mock.contactMessage.create.mockResolvedValue({ id: 1 })
})

describe('the topic list', () => {
  it('splits every topic into exactly one inbox, and a missing topic is a lead', () => {
    expect(new Set(CONTACT_TOPICS).size).toBe(LEAD_TOPICS.length + SUPPORT_TOPICS.length)
    for (const t of LEAD_TOPICS) expect(boxFor(t)).toBe('leads')
    for (const t of SUPPORT_TOPICS) expect(boxFor(t)).toBe('support')
    expect(boxFor(null)).toBe('leads')
    expect(boxWhere('leads')).toEqual({ OR: [{ topic: null }, { topic: { in: ['sales', 'club'] } }] })
  })
})

describe('POST /api/contact with a topic', () => {
  it('stores the topic and puts it at the front of the email to support', async () => {
    const res = await contact({ topic: 'complaint' })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.create.mock.calls[0][0].data).toMatchObject({ topic: 'complaint' })
    expect(sendMailMock.mock.calls[0][0].subject).toMatch(/^\[Complaint\] Contact form: Olly P/)
  })

  it('marks a club enquiry as a club', async () => {
    await contact({ topic: 'club' })
    expect(mock.contactMessage.create.mock.calls[0][0].data).toMatchObject({ topic: 'club', kind: 'club' })
  })

  it('files a message with no topic (an old page) as "other"', async () => {
    await contact()
    expect(mock.contactMessage.create.mock.calls[0][0].data.topic).toBe('other')
  })

  it('refuses a topic that does not exist', async () => {
    expect((await contact({ topic: 'spam' })).statusCode).toBe(422)
  })
})

describe('Admin: two inboxes', () => {
  const get = async (url: string) => {
    const app = await getApp()
    return app.inject({ method: 'GET', url, headers: authHeaders(await accessToken()) })
  }
  beforeEach(() => {
    asOwner()
    mock.contactMessage.findMany.mockResolvedValue([])
  })

  it('Leads shows only leads', async () => {
    await get('/api/admin/leads')
    expect(mock.contactMessage.findMany.mock.calls[0][0].where.AND).toEqual([boxWhere('leads')])
  })

  it('Support shows only support, and can narrow to one topic', async () => {
    await get('/api/admin/leads?box=support&topic=complaint')
    expect(mock.contactMessage.findMany.mock.calls[0][0].where.AND).toEqual([boxWhere('support'), { topic: 'complaint' }])
  })

  it('a message can be moved to the other inbox', async () => {
    mock.contactMessage.update.mockResolvedValue({ id: 3, topic: 'sales' })
    const app = await getApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/admin/leads/3', headers: authHeaders(await accessToken()), payload: { topic: 'sales' },
    })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.update.mock.calls[0][0].data).toEqual({ topic: 'sales' })
  })
})
