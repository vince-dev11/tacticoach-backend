// Books as courses: quizzes marked on the server, progress, certificates.
//
// A book becomes a course when its author switches Course mode on. From then:
//
//   - Each quiz question has a right answer and an explanation, and the READER
//     NEVER RECEIVES THEM with the chapter. They choose, we mark, and only then
//     is the answer shown. A certificate that can be earned by reading the
//     answers out of the page source is not worth printing.
//   - One retake per question. The latest answer counts, so a reader can put
//     one mistake right, but the score still means something.
//   - The certificate needs every chapter read AND the pass mark (80%) across
//     all the quiz questions in the book.
//
// Progress hangs off STABLE keys — a chapter's `key` and a question's `id` —
// because saving a book rewrites every chapter and block id (see
// replaceChapters). Both are assigned here, on save, and kept by the editor.

import { randomBytes, randomInt } from 'node:crypto'
import { db } from '../../config/database.js'

export const MAX_ATTEMPTS = 2
export const DEFAULT_PASS_PERCENT = 80

// ---- Stable keys -------------------------------------------------------------

/** 12 url-safe characters. Chapter keys and question ids. */
export const newKey = () => randomBytes(9).toString('base64url')

const KEY_RE = /^[A-Za-z0-9_-]{6,24}$/

/** A key the client sent back, if it is one of ours in shape; else a new one. */
export const keepOrNewKey = (k: unknown) => (typeof k === 'string' && KEY_RE.test(k) ? k : newKey())

export interface QuizQuestion {
  id?: string
  q?: string
  options?: string[]
  /** Index of the right option. */
  correct?: number
  /** Why — shown after answering. */
  why?: string
}

/**
 * Give every quiz question a stable id (keeping the ones it has), and drop a
 * `correct` that points at no option. Run on every save.
 */
export function withQuestionIds(kind: string, data: Record<string, unknown>): Record<string, unknown> {
  if (kind !== 'quiz' || !Array.isArray(data.questions)) return data
  const seen = new Set<string>()
  const questions = (data.questions as QuizQuestion[]).map((q) => {
    let id = keepOrNewKey(q?.id)
    // Duplicated in the editor (copy-paste of a block): ids must stay unique
    // within a book or two questions would share one answer row.
    while (seen.has(id)) id = newKey()
    seen.add(id)
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? '')) : []
    const correct = Number.isInteger(q?.correct) && (q.correct as number) >= 0 && (q.correct as number) < options.length
      ? q.correct : undefined
    return { ...q, id, options, correct }
  })
  return { ...data, questions }
}

/**
 * The quiz as a course reader receives it: questions and options only. The
 * answer and the explanation stay on the server until they have answered.
 */
export function stripAnswers(blocks: { kind: string; data: unknown }[]) {
  return blocks.map((b) => {
    if (b.kind !== 'quiz') return b
    const data = (b.data ?? {}) as Record<string, unknown>
    const questions = Array.isArray(data.questions)
      ? (data.questions as QuizQuestion[]).map(({ id, q, options }) => ({ id, q, options }))
      : []
    return { ...b, data: { ...data, questions, marked: true } }
  })
}

/** Every markable question in a set of chapters, with where it lives. */
export function questionsOf(chapters: { key: string; blocks: { kind: string; data: unknown }[] }[]) {
  const out: { id: string; chapterKey: string; correct: number; why: string; options: number }[] = []
  for (const ch of chapters) {
    for (const b of ch.blocks) {
      if (b.kind !== 'quiz') continue
      const qs = ((b.data ?? {}) as { questions?: QuizQuestion[] }).questions ?? []
      for (const q of qs) {
        if (!q?.id || !Number.isInteger(q.correct)) continue
        out.push({ id: q.id, chapterKey: ch.key, correct: q.correct as number, why: q.why ?? '', options: q.options?.length ?? 0 })
      }
    }
  }
  return out
}

// ---- Loading a course ----------------------------------------------------------

export class CourseError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

interface CourseBook {
  id: number
  slug: string
  title: string
  subtitle: string | null
  isCourse: boolean
  passPercent: number
  studyMinutes: number | null
  clubId: number | null
  clubAudience: string | null
  authorId: number
  chapters: { id: number; key: string; title: string; blocks: { kind: string; data: unknown }[] }[]
}

/** A published course, whole — for marking only. Never sent to a client. */
export async function loadCourse(slug: string): Promise<CourseBook> {
  const book = await db.ebook.findFirst({
    where: { slug, status: 'published' },
    select: {
      id: true, slug: true, title: true, subtitle: true, isCourse: true, passPercent: true,
      studyMinutes: true, clubId: true, clubAudience: true, authorId: true,
      chapters: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, key: true, title: true, blocks: { orderBy: { sortOrder: 'asc' }, select: { kind: true, data: true } } },
      },
    },
  })
  if (!book) throw new CourseError(404, 'Book not found')
  if (!book.isCourse) throw new CourseError(409, 'This book is not a course.')
  return book as unknown as CourseBook
}

// ---- Progress ------------------------------------------------------------------

export interface CourseStatus {
  isCourse: true
  passPercent: number
  studyMinutes: number | null
  chapters: { id: number; key: string; title: string; read: boolean; questions: number; answered: number; correct: number }[]
  score: { correct: number; answered: number; total: number; percent: number }
  /** Every chapter read and every question answered. */
  finished: boolean
  passed: boolean
  certificate: { code: string } | null
}

export async function courseStatus(userId: number, book: CourseBook): Promise<CourseStatus> {
  const questions = questionsOf(book.chapters)
  const [answers, reads, cert] = await Promise.all([
    db.ebookQuizAnswer.findMany({ where: { userId, ebookId: book.id }, select: { questionId: true, correct: true } }),
    db.ebookChapterRead.findMany({ where: { userId, ebookId: book.id }, select: { chapterKey: true } }),
    db.ebookCertificate.findUnique({ where: { userId_ebookId: { userId, ebookId: book.id } }, select: { code: true, revokedAt: true } }),
  ])
  // Only answers to questions that still exist count: an author may have
  // removed one since.
  const live = new Map(questions.map((q) => [q.id, q]))
  const byQ = new Map(answers.filter((a) => live.has(a.questionId)).map((a) => [a.questionId, a.correct]))
  const read = new Set(reads.map((r) => r.chapterKey))

  const chapters = book.chapters.map((c) => {
    const qs = questions.filter((q) => q.chapterKey === c.key)
    return {
      id: c.id,
      key: c.key,
      title: c.title,
      read: read.has(c.key),
      questions: qs.length,
      answered: qs.filter((q) => byQ.has(q.id)).length,
      correct: qs.filter((q) => byQ.get(q.id) === true).length,
    }
  })
  const total = questions.length
  const correct = [...byQ.values()].filter(Boolean).length
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100)
  const finished = chapters.every((c) => c.read) && byQ.size === total
  return {
    isCourse: true,
    passPercent: book.passPercent,
    studyMinutes: book.studyMinutes,
    chapters,
    score: { correct, answered: byQ.size, total, percent },
    finished,
    // A course with no questions cannot be passed: a certificate for scrolling
    // is not one.
    passed: finished && total > 0 && percent >= book.passPercent,
    certificate: cert && !cert.revokedAt ? { code: cert.code } : null,
  }
}

/** The reader got to the end of a chapter. By id, stored by key. */
export async function markRead(userId: number, book: CourseBook, chapterId: number) {
  const chapter = book.chapters.find((c) => c.id === chapterId)
  if (!chapter) throw new CourseError(404, 'Chapter not found')
  await db.ebookChapterRead.upsert({
    where: { userId_ebookId_chapterKey: { userId, ebookId: book.id, chapterKey: chapter.key } },
    update: {},
    create: { userId, ebookId: book.id, chapterKey: chapter.key },
  })
}

/**
 * Mark one answer. Returns whether it was right, the right answer and why —
 * the first time the reader sees them. A second attempt is allowed only after
 * a wrong first one; after that the answer stands.
 */
export async function answer(userId: number, book: CourseBook, questionId: string, choice: number) {
  const q = questionsOf(book.chapters).find((x) => x.id === questionId)
  if (!q) throw new CourseError(404, 'Question not found')
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options) throw new CourseError(400, 'That is not one of the options.')

  const key = { userId_ebookId_questionId: { userId, ebookId: book.id, questionId } }
  const prev = await db.ebookQuizAnswer.findUnique({ where: key, select: { correct: true, attempts: true } })
  if (prev && (prev.correct || prev.attempts >= MAX_ATTEMPTS)) {
    // Already settled: tell them again what it was, change nothing.
    return { correct: prev.correct, correctIndex: q.correct, why: q.why, attempts: prev.attempts, canRetry: false, settled: true }
  }
  const correct = choice === q.correct
  const attempts = (prev?.attempts ?? 0) + 1
  await db.ebookQuizAnswer.upsert({
    where: key,
    update: { choice, correct, attempts, answeredAt: new Date() },
    create: { userId, ebookId: book.id, questionId, chapterKey: q.chapterKey, choice, correct, attempts },
  })
  const canRetry = !correct && attempts < MAX_ATTEMPTS
  return {
    correct,
    // On a wrong first answer the right one stays hidden — that is the retake.
    correctIndex: correct || !canRetry ? q.correct : null,
    why: correct || !canRetry ? q.why : '',
    attempts,
    canRetry,
    settled: !canRetry,
  }
}

/** The reader's previous answers in one chapter, so a revisit shows them. */
export async function chapterAnswers(userId: number, book: CourseBook, chapterId: number) {
  const chapter = book.chapters.find((c) => c.id === chapterId)
  if (!chapter) return []
  const qs = questionsOf([chapter])
  if (qs.length === 0) return []
  const rows = await db.ebookQuizAnswer.findMany({
    where: { userId, ebookId: book.id, questionId: { in: qs.map((q) => q.id) } },
    select: { questionId: true, choice: true, correct: true, attempts: true },
  })
  return rows.map((r) => {
    const q = qs.find((x) => x.id === r.questionId)!
    const settled = r.correct || r.attempts >= MAX_ATTEMPTS
    return {
      questionId: r.questionId,
      choice: r.choice,
      correct: r.correct,
      attempts: r.attempts,
      canRetry: !settled,
      correctIndex: settled ? q.correct : null,
      why: settled ? q.why : '',
    }
  })
}

// ---- Certificates --------------------------------------------------------------

/** No 0/O, 1/I/L: a code read aloud over the phone must survive it. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function certificateCode(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `TC-${pick(4)}-${pick(4)}`
}
export const CODE_RE = /^TC-[A-Z2-9]{4}-[A-Z2-9]{4}$/

const fullName = (u: { name: string; surname: string | null }) => [u.name, u.surname].filter(Boolean).join(' ').trim()

/**
 * Issue the certificate — or return the one already issued. Refuses, with the
 * reason, until every chapter is read and the pass mark is reached.
 */
export async function issueCertificate(userId: number, book: CourseBook) {
  const existing = await db.ebookCertificate.findUnique({
    where: { userId_ebookId: { userId, ebookId: book.id } },
    select: { code: true, revokedAt: true },
  })
  if (existing && !existing.revokedAt) return { code: existing.code, issued: false }

  const status = await courseStatus(userId, book)
  if (!status.finished) throw new CourseError(422, 'Finish every chapter and answer every question first.')
  if (!status.passed) {
    throw new CourseError(422, `You scored ${status.score.percent}%. You need ${status.passPercent}% to pass.`)
  }

  const [holder, full] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, surname: true } }),
    db.ebook.findUnique({
      where: { id: book.id },
      select: {
        author: { select: { name: true, surname: true, coachTitle: true, coachPageEnabled: true } },
        coauthors: {
          where: { acceptedAt: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { name: true, surname: true, coachTitle: true, coachPageEnabled: true } } },
        },
        club: { select: { name: true } },
      },
    }),
  ])
  if (!holder) throw new CourseError(404, 'Account not found')
  const person = (u: { name: string; surname: string | null; coachTitle: string | null; coachPageEnabled: boolean }, role: 'author' | 'coauthor') => ({
    name: fullName(u),
    role,
    title: u.coachPageEnabled ? u.coachTitle ?? null : null,
  })
  const authors = [
    ...(full?.author ? [person(full.author, 'author')] : []),
    ...(full?.coauthors ?? []).filter((c) => c.user).map((c) => person(c.user!, 'coauthor')),
  ]

  const data = {
    userId,
    ebookId: book.id,
    holderName: fullName(holder).slice(0, 160) || 'TactiCoach reader',
    courseTitle: book.title.slice(0, 160),
    courseSub: book.subtitle?.slice(0, 200) ?? null,
    authors,
    chapters: book.chapters.length,
    correct: status.score.correct,
    total: status.score.total,
    percent: status.score.percent,
    studyMinutes: book.studyMinutes,
    topics: book.chapters.map((c) => c.title).slice(0, 8),
    clubName: full?.club?.name ?? null,
  }

  // A revoked certificate is replaced with a new code; the old one keeps
  // saying "revoked" on the verify page. Otherwise: a new row, retrying on
  // the (astronomically unlikely) code collision.
  for (let i = 0; i < 5; i++) {
    const code = certificateCode()
    try {
      if (existing) {
        await db.ebookCertificate.update({
          where: { userId_ebookId: { userId, ebookId: book.id } },
          data: { ...data, code, issuedAt: new Date(), revokedAt: null, revokeReason: null },
        })
      } else {
        await db.ebookCertificate.create({ data: { ...data, code } })
      }
      return { code, issued: true }
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002' && i < 4) continue
      throw err
    }
  }
  throw new CourseError(500, 'Could not issue a certificate. Please try again.')
}

/**
 * What the verify page and the certificate page show. Only what is printed
 * on the certificate — never the holder's email, account or anything else.
 */
export async function certificateByCode(code: string) {
  const c = code.trim().toUpperCase()
  if (!CODE_RE.test(c)) return null
  const row = await db.ebookCertificate.findUnique({
    where: { code: c },
    select: {
      code: true, holderName: true, courseTitle: true, courseSub: true, authors: true, chapters: true,
      correct: true, total: true, percent: true, studyMinutes: true, topics: true, clubName: true,
      issuedAt: true, revokedAt: true, revokeReason: true,
      ebook: { select: { slug: true, status: true, clubId: true } },
    },
  })
  if (!row) return null
  const { ebook, ...cert } = row
  return {
    ...cert,
    // A link to the course only while it is in the shop; a club book is private.
    courseSlug: ebook.status === 'published' && !ebook.clubId ? ebook.slug : null,
  }
}

export async function myCertificates(userId: number) {
  return db.ebookCertificate.findMany({
    where: { userId, revokedAt: null },
    orderBy: { issuedAt: 'desc' },
    select: { code: true, courseTitle: true, percent: true, issuedAt: true, clubName: true },
  })
}

// ---- Badges --------------------------------------------------------------------

export type BadgeId = 'first_chapter' | 'perfect_quiz' | 'course_complete' | 'series_complete' | 'three_courses'

/**
 * Computed from what the reader has done, never stored — so there is nothing
 * to get out of step, and nothing to award by hand.
 */
export async function badgesFor(userId: number): Promise<{ id: BadgeId; earned: boolean }[]> {
  const [reads, certs, answers] = await Promise.all([
    db.ebookChapterRead.count({ where: { userId } }),
    db.ebookCertificate.findMany({ where: { userId, revokedAt: null }, select: { ebookId: true } }),
    db.ebookQuizAnswer.findMany({ where: { userId }, select: { ebookId: true, chapterKey: true, correct: true } }),
  ])
  // A perfect chapter: at least 3 questions answered in it, every one right.
  const perChapter = new Map<string, { n: number; ok: number }>()
  for (const a of answers) {
    const k = `${a.ebookId}:${a.chapterKey}`
    const v = perChapter.get(k) ?? { n: 0, ok: 0 }
    v.n += 1
    if (a.correct) v.ok += 1
    perChapter.set(k, v)
  }
  const perfect = [...perChapter.values()].some((v) => v.n >= 3 && v.ok === v.n)

  let seriesDone = false
  if (certs.length >= 2) {
    const certified = new Set(certs.map((c) => c.ebookId))
    const inSeries = await db.ebook.findMany({
      where: { id: { in: [...certified] }, seriesId: { not: null } },
      select: { seriesId: true },
    })
    for (const sid of new Set(inSeries.map((b) => b.seriesId!))) {
      const courses = await db.ebook.findMany({ where: { seriesId: sid, status: 'published', isCourse: true }, select: { id: true } })
      if (courses.length >= 2 && courses.every((b) => certified.has(b.id))) seriesDone = true
    }
  }
  return [
    { id: 'first_chapter', earned: reads > 0 },
    { id: 'perfect_quiz', earned: perfect },
    { id: 'course_complete', earned: certs.length > 0 },
    { id: 'series_complete', earned: seriesDone },
    { id: 'three_courses', earned: certs.length >= 3 },
  ]
}

/** A random token for invites (co-authors). */
export const inviteToken = () => randomBytes(24).toString('base64url')

// ---- Reading time --------------------------------------------------------------
// Same arithmetic as the reader (readerSettings.ts): 200 words a minute, a
// figure is 25 seconds. Computed here so the book page can say "≈ 6 min" per
// chapter without ever being sent a chapter's blocks.

const WPM = 200
const FIGURE_SECONDS = 25
const TEXT_KINDS = new Set(['text', 'quote', 'character', 'your_turn', 'quiz'])

function countWords(v: unknown, into: { words: number }): void {
  if (typeof v === 'string') into.words += v.trim().split(/\s+/).filter(Boolean).length
  else if (Array.isArray(v)) v.forEach((x) => countWords(x, into))
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k !== 'canvas' && k !== 'frames' && k !== 'state') countWords(x, into)
    }
  }
}

export function readingMinutes(blocks: { kind: string; data: unknown }[]): number {
  const into = { words: 0 }
  let figures = 0
  for (const b of blocks) {
    const d = (b.data ?? {}) as Record<string, unknown>
    if (TEXT_KINDS.has(b.kind)) countWords(d, into)
    else {
      figures += 1
      countWords({ caption: d.caption, title: d.title, points: d.points, question: d.question, explain: d.explain }, into)
    }
  }
  return Math.max(1, Math.round(into.words / WPM + (figures * FIGURE_SECONDS) / 60))
}

/** Minutes per chapter of a book, by chapter id. One query, counts only. */
export async function chapterMinutes(ebookId: number): Promise<Map<number, number>> {
  const chapters = await db.ebookChapter.findMany({
    where: { ebookId },
    select: { id: true, blocks: { select: { kind: true, data: true } } },
  })
  return new Map(chapters.map((c) => [c.id, readingMinutes(c.blocks)]))
}
