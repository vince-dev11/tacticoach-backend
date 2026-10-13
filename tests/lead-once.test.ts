// LEAD-ONCE (owner, 13 Oct 2026): one lead per person. A visitor who asks for
// early access or a demo again joins their open lead instead of adding a row
// to Leads each time; support questions stay separate tickets.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const form = { first_name: 'Sam', last_name: 'Reed', email: 'Sam@Club.test ', message: 'Early access request\nI am: Coach\nWas looking at: pro (monthly)' }
async function contact(extra: Record<string, unknown> = {}) {
  const app = await getApp()
  return app.inject({ method: 'POST', url: '/api/contact', payload: { ...form, ...extra } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isMailConfigured).mockReturnValue(true)
  vi.mocked(sendMail).mockResolvedValue(undefined)
  mock.contactMessage.findFirst.mockResolvedValue(null)
  mock.contactMessage.create.mockResolvedValue({ id: 1 })
  mock.contactMessage.update.mockResolvedValue({ id: 7 })
})

describe('LEAD-ONCE · one lead per person', () => {
  it('a first ask creates the lead', async () => {
    const res = await contact({ topic: 'sales' })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.create).toHaveBeenCalledTimes(1)
    expect(mock.contactMessage.update).not.toHaveBeenCalled()
  })

  it('asking again (different words) joins the open lead: words added with the date, back to New, times + 1', async () => {
    // 1st findFirst = the exact-copy check (none); 2nd = the open lead.
    mock.contactMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 7, message: 'Early access request\nI am: Coach', times: 2, kind: 'unknown' })
    const res = await contact({ topic: 'sales' })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.create).not.toHaveBeenCalled()
    const arg = mock.contactMessage.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 7 })
    expect(arg.data.times).toBe(3)
    expect(arg.data.status).toBe('new')
    expect(arg.data.message).toMatch(/^Early access request\nI am: Coach\n\n— \d{4}-\d{2}-\d{2} —\nEarly access request/)
    // The open-lead lookup: same email (trimmed, lower case), not closed, a lead topic.
    const where = mock.contactMessage.findFirst.mock.calls[1][0].where
    expect(where).toMatchObject({ email: 'sam@club.test', status: { not: 'closed' } })
  })

  it('a club asking again marks the lead as a club', async () => {
    mock.contactMessage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 7, message: 'hi there, demo please', times: 1, kind: 'unknown' })
    await contact({ topic: 'club' })
    expect(mock.contactMessage.update.mock.calls[0][0].data).toMatchObject({ topic: 'club', kind: 'club', times: 2 })
  })

  it('a support question is never folded into a lead — two problems are two tickets', async () => {
    await contact({ topic: 'bug', message: 'The export does not work on my iPad.' })
    expect(mock.contactMessage.findFirst).toHaveBeenCalledTimes(1) // the exact-copy check only
    expect(mock.contactMessage.create).toHaveBeenCalledTimes(1)
  })

  it('the exact same words within a day are still answered without storing anything', async () => {
    mock.contactMessage.findFirst.mockResolvedValueOnce({ id: 9 })
    const res = await contact({ topic: 'sales' })
    expect(res.statusCode).toBe(200)
    expect(mock.contactMessage.create).not.toHaveBeenCalled()
    expect(mock.contactMessage.update).not.toHaveBeenCalled()
  })
})
