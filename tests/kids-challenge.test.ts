// KIDS-F6 (26 Oct 2026) — a small home challenge sent with a player's
// feedback: stored trimmed (blank = none), shown to the player and parent,
// and in the email — escaped, because a coach typed it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbMock } from './setup.js'
import { writeNote } from '../src/modules/feedback/feedback.service.js'
import { sendPlayerNoteEmail } from '../src/lib/emails.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)

beforeEach(() => { vi.clearAllMocks(); mailConfigured.mockReturnValue(true); sendMailMock.mockResolvedValue(undefined) })
afterEach(() => mailConfigured.mockReturnValue(false))

describe('KIDS-F6 · the challenge is stored with the note', () => {
  it('trimmed on a new note; blank means none', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue(null)
    mock.playerNote.create.mockResolvedValue({ id: 1 })
    await writeNote(1, 7, { squadPlayerId: 5, body: 'good week', strengths: [], workOns: [], challenge: '  50 touches with your left  ' })
    expect(mock.playerNote.create.mock.calls[0][0].data.challenge).toBe('50 touches with your left')

    mock.playerNote.create.mockClear()
    await writeNote(1, 7, { squadPlayerId: 5, body: 'x', strengths: [], workOns: [], challenge: '   ' })
    expect(mock.playerNote.create.mock.calls[0][0].data.challenge).toBeNull()
  })
  it('kept when the coach edits an unsent note', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5 })
    mock.playerNote.findFirst.mockResolvedValue({ id: 3, createdAt: new Date(), sentAt: null, coachUserId: 1 })
    mock.playerNote.update.mockResolvedValue({ id: 3 })
    await writeNote(1, 7, { squadPlayerId: 5, body: 'y', strengths: [], workOns: [], challenge: 'Keepy-ups: beat 10' })
    expect(mock.playerNote.update.mock.calls[0][0].data.challenge).toBe('Keepy-ups: beat 10')
  })
})

describe('KIDS-F6 · the email carries it', () => {
  it('in the text and the HTML, escaped', async () => {
    await sendPlayerNoteEmail({
      to: 'p@test.dev', cc: 'parent@test.dev', playerName: 'Sam', coachName: 'Coach', clubName: null,
      body: 'Well done', strengths: [], workOns: [], session: null,
      digest: { total: 1, strengths: [], workOns: [] }, boardId: null, guardianToken: null,
      challenge: '50 touches <left> foot',
    })
    const mail = sendMailMock.mock.calls[0][0] as { text: string; html: string }
    expect(mail.text).toContain('Your challenge at home: 50 touches <left> foot')
    expect(mail.html).toContain('50 touches &lt;left&gt; foot')
    expect(mail.html).not.toContain('<left>')
  })
})
