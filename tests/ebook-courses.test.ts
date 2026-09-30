// Books as courses — the rules a certificate's value depends on:
//
//   - a course reader never receives the quiz answers with the chapter
//   - answers are marked on the server; one retake, then it stands
//   - the certificate needs every chapter read AND 80% overall
//   - the public verify lookup shows what is printed, nothing about the account
//   - club books never reach the shop, and only club members can open them
//   - a co-author invite works only for the address it was sent to

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import {
  withQuestionIds, stripAnswers, questionsOf, certificateCode, CODE_RE, courseStatus,
} from '../src/modules/ebooks/course.service.js'
import { audienceAllows } from '../src/modules/ebooks/club-books.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function callerIs(accountType: 'coach' | 'player' = 'coach') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role: 'user', accountType } as never)
    }
    return Promise.resolve({ id: 1, name: 'Daniel', surname: 'Okafor', email: 'coach@test.dev', role: 'user', accountType } as never)
  })
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, signedIn = true) {
  const app = await getApp()
  return app.inject({ method, url, headers: signedIn ? authHeaders(await accessToken()) : {}, payload: payload as never })
}

const quiz = (questions: unknown[]) => ({ kind: 'quiz', data: { questions } })
const Q1 = { id: 'q1aaaaaa', q: 'Who presses first?', options: ['#4', '#8', '#9'], correct: 1, why: 'Closest.' }
const Q2 = { id: 'q2aaaaaa', q: 'When?', options: ['At once', 'Later'], correct: 0, why: 'Three seconds.' }

/** A published course: two chapters, one question each. */
const COURSE = {
  id: 7, slug: 'pressing', title: 'Pressing with purpose', subtitle: null, isCourse: true, passPercent: 80,
  studyMinutes: 270, clubId: null, clubAudience: null, authorId: 2,
  chapters: [
    { id: 11, key: 'chapAAAAAA', title: 'Triggers', blocks: [quiz([Q1])] },
    { id: 12, key: 'chapBBBBBB', title: 'Counter-press', blocks: [quiz([Q2])] },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  callerIs('coach')
  mock.clubMember.findUnique.mockResolvedValue(null as never)
  mock.club.findUnique.mockResolvedValue(null as never)
  mock.squadPlayer.findMany.mockResolvedValue([] as never)
})

// ---------------------------------------------------------------------------

describe('quiz questions', () => {
  it('get a stable id on save, and keep the one they have', () => {
    const out = withQuestionIds('quiz', { questions: [{ q: 'A', options: ['x', 'y'], correct: 1 }, { ...Q1 }] }) as { questions: { id: string; correct?: number }[] }
    expect(out.questions[0].id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(out.questions[1].id).toBe(Q1.id)
    expect(out.questions[0].correct).toBe(1)
  })

  it('never share an id, even when a block was copied', () => {
    const out = withQuestionIds('quiz', { questions: [{ ...Q1 }, { ...Q1 }] }) as { questions: { id: string }[] }
    expect(out.questions[0].id).not.toBe(out.questions[1].id)
  })

  it('drop a "correct" that points at no option', () => {
    const out = withQuestionIds('quiz', { questions: [{ q: 'A', options: ['x'], correct: 3 }] }) as { questions: { correct?: number }[] }
    expect(out.questions[0].correct).toBeUndefined()
  })

  it('reach a course reader without the answer or the explanation', () => {
    const [b] = stripAnswers([quiz([Q1])]) as { data: { questions: Record<string, unknown>[]; marked: boolean } }[]
    expect(b.data.questions[0]).toEqual({ id: Q1.id, q: Q1.q, options: Q1.options })
    expect(JSON.stringify(b)).not.toContain('Closest')
    expect(b.data.marked).toBe(true)
  })

  it('count only questions with a right answer', () => {
    expect(questionsOf([{ key: 'k', blocks: [quiz([Q1, { id: 'x', q: 'no answer', options: ['a'] }])] }])).toHaveLength(1)
  })
})

describe('reading a course chapter', () => {
  it('strips the answers from the chapter it serves', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue({
      id: 11, title: 'Triggers', sortOrder: 0, isSample: true, ebookId: 7,
      blocks: [{ id: 1, sortOrder: 0, ...quiz([Q1]) }],
    } as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'x', slug: 'pressing', isCourse: true, clubId: null, clubAudience: null } as never)
    const res = await call('GET', '/api/ebooks/pressing/c/11')
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('Closest')
    expect(res.body).not.toContain('"correct"')
    expect(res.json().course).toBe(true)
  })
})

describe('marking an answer', () => {
  beforeEach(() => {
    mock.ebook.findFirst.mockResolvedValue(COURSE as never)
  })

  it('a right answer: marked right, with the explanation', async () => {
    mock.ebookQuizAnswer.findUnique.mockResolvedValue(null as never)
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 1 })
    expect(res.json()).toMatchObject({ correct: true, correctIndex: 1, why: 'Closest.', canRetry: false })
    expect(mock.ebookQuizAnswer.upsert.mock.calls[0][0].create).toMatchObject({ questionId: Q1.id, chapterKey: 'chapAAAAAA', correct: true, attempts: 1 })
  })

  it('a wrong first answer: one retake, and the answer stays hidden', async () => {
    mock.ebookQuizAnswer.findUnique.mockResolvedValue(null as never)
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 0 })
    expect(res.json()).toMatchObject({ correct: false, correctIndex: null, why: '', canRetry: true })
  })

  it('a wrong second answer: it stands, and now the answer is shown', async () => {
    mock.ebookQuizAnswer.findUnique.mockResolvedValue({ correct: false, attempts: 1 } as never)
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 2 })
    expect(res.json()).toMatchObject({ correct: false, correctIndex: 1, canRetry: false, attempts: 2 })
  })

  it('a settled answer cannot be changed', async () => {
    mock.ebookQuizAnswer.findUnique.mockResolvedValue({ correct: false, attempts: 2 } as never)
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 1 })
    expect(res.json()).toMatchObject({ settled: true, correct: false })
    expect(mock.ebookQuizAnswer.upsert).not.toHaveBeenCalled()
  })

  it('refuses an option that does not exist', async () => {
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 7 })
    expect(res.statusCode).toBe(400)
  })

  it('needs an account', async () => {
    const res = await call('POST', `/api/ebooks/pressing/quiz/${Q1.id}`, { choice: 1 }, false)
    expect(res.statusCode).toBe(401)
  })
})

describe('passing the course', () => {
  const progress = (answers: { questionId: string; correct: boolean }[], reads: string[]) => {
    mock.ebookQuizAnswer.findMany.mockResolvedValue(answers as never)
    mock.ebookChapterRead.findMany.mockResolvedValue(reads.map((chapterKey) => ({ chapterKey })) as never)
    mock.ebookCertificate.findUnique.mockResolvedValue(null as never)
  }

  it('needs every chapter read, not just the answers', async () => {
    progress([{ questionId: Q1.id, correct: true }, { questionId: Q2.id, correct: true }], ['chapAAAAAA'])
    const s = await courseStatus(1, COURSE)
    expect(s.score.percent).toBe(100)
    expect(s.finished).toBe(false)
    expect(s.passed).toBe(false)
  })

  it('needs 80%: one of two right is not a pass', async () => {
    progress([{ questionId: Q1.id, correct: true }, { questionId: Q2.id, correct: false }], ['chapAAAAAA', 'chapBBBBBB'])
    const s = await courseStatus(1, COURSE)
    expect(s.finished).toBe(true)
    expect(s.score.percent).toBe(50)
    expect(s.passed).toBe(false)
  })

  it('ignores answers to questions the author has since removed', async () => {
    progress([{ questionId: Q1.id, correct: true }, { questionId: Q2.id, correct: true }, { questionId: 'gone', correct: false }], ['chapAAAAAA', 'chapBBBBBB'])
    const s = await courseStatus(1, COURSE)
    expect(s.score).toMatchObject({ correct: 2, total: 2, percent: 100 })
    expect(s.passed).toBe(true)
  })

  it('refuses a certificate before the pass, with the reason', async () => {
    mock.ebook.findFirst.mockResolvedValue(COURSE as never)
    progress([{ questionId: Q1.id, correct: true }, { questionId: Q2.id, correct: false }], ['chapAAAAAA', 'chapBBBBBB'])
    const res = await call('POST', '/api/ebooks/pressing/certificate')
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toContain('50%')
    expect(mock.ebookCertificate.create).not.toHaveBeenCalled()
  })

  it('issues one after the pass, with everything printed copied in', async () => {
    mock.ebook.findFirst.mockResolvedValue(COURSE as never)
    progress([{ questionId: Q1.id, correct: true }, { questionId: Q2.id, correct: true }], ['chapAAAAAA', 'chapBBBBBB'])
    mock.ebook.findUnique.mockResolvedValue({
      author: { name: 'Marcus', surname: 'Hale', coachTitle: 'UEFA B coach', coachPageEnabled: true },
      coauthors: [{ user: { name: 'Ana', surname: 'Ruiz', coachTitle: null, coachPageEnabled: false } }],
      club: null,
    } as never)
    const res = await call('POST', '/api/ebooks/pressing/certificate')
    expect(res.statusCode).toBe(200)
    expect(res.json().code).toMatch(CODE_RE)
    const data = mock.ebookCertificate.create.mock.calls[0][0].data
    expect(data).toMatchObject({ holderName: 'Daniel Okafor', courseTitle: 'Pressing with purpose', percent: 100, chapters: 2, topics: ['Triggers', 'Counter-press'] })
    expect(data.authors).toEqual([
      { name: 'Marcus Hale', role: 'author', title: 'UEFA B coach' },
      { name: 'Ana Ruiz', role: 'coauthor', title: null },
    ])
  })

  it('returns the certificate already issued instead of a second one', async () => {
    mock.ebook.findFirst.mockResolvedValue(COURSE as never)
    mock.ebookCertificate.findUnique.mockResolvedValue({ code: 'TC-ABCD-EFGH', revokedAt: null } as never)
    const res = await call('POST', '/api/ebooks/pressing/certificate')
    expect(res.json()).toEqual({ code: 'TC-ABCD-EFGH', issued: false })
    expect(mock.ebookCertificate.create).not.toHaveBeenCalled()
  })
})

describe('checking a certificate (public)', () => {
  it('codes are TC-XXXX-XXXX, without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = certificateCode()
      expect(c).toMatch(CODE_RE)
      expect(c.slice(3)).not.toMatch(/[01OIL]/)
    }
  })

  it('shows what is printed, and nothing about the account', async () => {
    mock.ebookCertificate.findUnique.mockResolvedValue({
      code: 'TC-7F3K-9Q2M', holderName: 'Daniel Okafor', courseTitle: 'Pressing with purpose', courseSub: null,
      authors: [], chapters: 8, correct: 46, total: 50, percent: 92, studyMinutes: 260, topics: [], clubName: null,
      issuedAt: new Date('2026-09-29'), revokedAt: null, revokeReason: null,
      ebook: { slug: 'pressing', status: 'published', clubId: null },
    } as never)
    const res = await call('GET', '/api/certificates/tc-7f3k-9q2m', undefined, false)
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-robots-tag']).toBe('noindex')
    const body = res.json()
    expect(body.holderName).toBe('Daniel Okafor')
    expect(body.courseSlug).toBe('pressing')
    // The lookup never selects the holder's account.
    const select = mock.ebookCertificate.findUnique.mock.calls[0][0].select
    expect(select).not.toHaveProperty('userId')
    expect(select).not.toHaveProperty('user')
    expect(mock.ebookCertificate.findUnique.mock.calls[0][0].where).toEqual({ code: 'TC-7F3K-9Q2M' })
  })

  it('a malformed code is not looked up at all', async () => {
    const res = await call('GET', '/api/certificates/DROP%20TABLE', undefined, false)
    expect(res.statusCode).toBe(404)
    expect(mock.ebookCertificate.findUnique).not.toHaveBeenCalled()
  })

  it('a club course links to nothing (the book is private)', async () => {
    mock.ebookCertificate.findUnique.mockResolvedValue({
      code: 'TC-7F3K-9Q2M', holderName: 'A', courseTitle: 'B', courseSub: null, authors: [], chapters: 1, correct: 1,
      total: 1, percent: 100, studyMinutes: null, topics: [], clubName: 'Westfield Rovers', issuedAt: new Date(),
      revokedAt: null, revokeReason: null, ebook: { slug: 'rovers-way', status: 'published', clubId: 3 },
    } as never)
    const body = (await call('GET', '/api/certificates/TC-7F3K-9Q2M', undefined, false)).json()
    expect(body.courseSlug).toBeNull()
    expect(body.clubName).toBe('Westfield Rovers')
  })
})

describe('club books', () => {
  it('coaches read every club book; players only theirs', () => {
    expect(audienceAllows('coaches', 'coach')).toBe(true)
    expect(audienceAllows('players', 'coach')).toBe(true)
    expect(audienceAllows('coaches', 'player')).toBe(false)
    expect(audienceAllows('players', 'player')).toBe(true)
    expect(audienceAllows('everyone', 'player')).toBe(true)
    expect(audienceAllows('everyone', null)).toBe(false)
  })

  it('never appear in the shop', async () => {
    mock.ebook.findMany.mockResolvedValue([] as never)
    await call('GET', '/api/ebooks', undefined, false)
    expect(mock.ebook.findMany.mock.calls[0][0].where.clubId).toBeNull()
  })

  it('do not exist for someone outside the club', async () => {
    mock.ebook.findFirst.mockResolvedValue({
      id: 9, slug: 'rovers-way', title: 'The Rovers way', clubId: 3, clubAudience: 'coaches', chapters: [],
      author: { name: 'A', surname: null }, coauthors: [], club: { name: 'Westfield Rovers' },
    } as never)
    expect((await call('GET', '/api/ebooks/rovers-way', undefined, false)).statusCode).toBe(404)
    // Signed in, but a coach at another club (or none).
    expect((await call('GET', '/api/ebooks/rovers-way')).statusCode).toBe(404)
  })

  it('open for a coach of the club', async () => {
    mock.ebook.findFirst.mockResolvedValue({
      id: 9, slug: 'rovers-way', title: 'The Rovers way', clubId: 3, clubAudience: 'coaches', chapters: [],
      author: { name: 'A', surname: null }, coauthors: [], club: { name: 'Westfield Rovers' }, isCourse: false,
    } as never)
    mock.clubMember.findUnique.mockResolvedValue({ clubId: 3, role: 'member', club: { owner: { subscription: null } } } as never)
    mock.ebookProgress.findUnique.mockResolvedValue(null as never)
    const res = await call('GET', '/api/ebooks/rovers-way')
    expect(res.statusCode).toBe(200)
    expect(res.json().clubName).toBe('Westfield Rovers')
  })
})

describe('co-authors', () => {
  it('an invite accepts only for the address it was sent to', async () => {
    mock.ebookCoauthor.findUnique.mockResolvedValue({ id: 4, email: 'ana@club.test', ebookId: 5, acceptedAt: null } as never)
    const res = await call('POST', '/api/my-books/coauthors/accept', { token: 'x'.repeat(32) })
    expect(res.statusCode).toBe(403)
    expect(mock.ebookCoauthor.update).not.toHaveBeenCalled()
  })

  it('the right person accepts, and is linked to the book', async () => {
    mock.ebookCoauthor.findUnique.mockResolvedValue({ id: 4, email: 'COACH@test.dev', ebookId: 5, acceptedAt: null } as never)
    const res = await call('POST', '/api/my-books/coauthors/accept', { token: 'x'.repeat(32) })
    expect(res.statusCode).toBe(200)
    expect(mock.ebookCoauthor.update.mock.calls[0][0].data).toMatchObject({ userId: 1 })
  })

  it('only the author can invite, and the author keeps at least 10%', async () => {
    mock.ebook.findFirst.mockResolvedValue({ id: 5, title: 'B', coauthors: [{ id: 1, sharePercent: 60 }] } as never)
    const res = await call('POST', '/api/my-books/5/coauthors', { email: 'ana@club.test', sharePercent: 40 })
    expect(res.statusCode).toBe(422)
    // The lookup is scoped to the author — a co-author cannot invite.
    expect(mock.ebook.findFirst.mock.calls[0][0].where).toEqual({ id: 5, authorId: 1 })
  })
})
