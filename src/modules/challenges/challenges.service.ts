// Weekly tactical challenge — business logic. No background job anywhere
// here: "active", "current winner" and "past winners" are all derived from
// startsAt/endsAt and live vote counts at read time.

import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'

const COACH_SELECT = { id: true, name: true, surname: true, clubName: true } as const

export interface SubmissionDto {
  id: number
  boardId: number
  boardTitle: string
  thumbnailUrl: string | null
  videoUrl: string | null
  voteCount: number
  votedByMe: boolean
  isMine: boolean
  coach: { id: number; name: string; surname: string; clubName: string | null }
  createdAt: Date
}

interface SubmissionRow {
  id: number
  userId: number
  createdAt: Date
  board: { id: number; title: string; thumbnailKey: string | null; videoKey: string | null }
  user: { id: number; name: string; surname: string; clubName: string | null }
  votes: { userId: number }[]
}

async function toSubmissionDto(
  row: SubmissionRow,
  viewerUserId: number | undefined,
): Promise<SubmissionDto> {
  const [thumbnailUrl, videoUrl] = await Promise.all([
    row.board.thumbnailKey ? presignUrl(row.board.thumbnailKey) : Promise.resolve(null),
    row.board.videoKey ? presignUrl(row.board.videoKey) : Promise.resolve(null),
  ])
  return {
    id: row.id,
    boardId: row.board.id,
    boardTitle: row.board.title,
    thumbnailUrl,
    videoUrl,
    voteCount: row.votes.length,
    votedByMe: viewerUserId != null && row.votes.some((v) => v.userId === viewerUserId),
    isMine: viewerUserId != null && row.userId === viewerUserId,
    coach: row.user,
    createdAt: row.createdAt,
  }
}

const SUBMISSION_INCLUDE = {
  board: { select: { id: true, title: true, thumbnailKey: true, videoKey: true } },
  user: { select: COACH_SELECT },
  votes: { select: { userId: true } },
} as const

/** Ranked (most votes first, earliest entry breaks ties) submissions for a challenge. */
export async function listSubmissions(challengeId: number, viewerUserId?: number): Promise<SubmissionDto[]> {
  const rows: SubmissionRow[] = await db.challengeSubmission.findMany({
    where: { challengeId },
    include: SUBMISSION_INCLUDE,
  })
  const dtos = await Promise.all(rows.map((r) => toSubmissionDto(r, viewerUserId)))
  return dtos.sort((a: SubmissionDto, b: SubmissionDto) => b.voteCount - a.voteCount || a.createdAt.getTime() - b.createdAt.getTime())
}

export interface ChallengeDto {
  id: number
  title: string
  prompt: string
  tag: string | null
  startsAt: Date
  endsAt: Date
  submissionCount: number
}

/** The challenge whose window contains "now" — the one coaches can still enter. */
export async function getActiveChallenge(): Promise<ChallengeDto | null> {
  const now = new Date()
  const row = await db.challenge.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
    include: { _count: { select: { submissions: true } } },
  })
  if (!row) return null
  const { _count, ...rest } = row
  return { ...rest, submissionCount: _count.submissions }
}

export interface WinnerDto {
  challengeId: number
  title: string
  tag: string | null
  endsAt: Date
  winner: SubmissionDto | null
}

/** Closed challenges, newest first, each with its top-voted submission (if any). */
export async function listWinners(limit = 12): Promise<WinnerDto[]> {
  const now = new Date()
  const challenges: { id: number; title: string; tag: string | null; endsAt: Date }[] = await db.challenge.findMany({
    where: { endsAt: { lt: now } },
    orderBy: { endsAt: 'desc' },
    take: limit,
  })
  return Promise.all(
    challenges.map(async (c: { id: number; title: string; tag: string | null; endsAt: Date }) => {
      const ranked = await listSubmissions(c.id)
      return { challengeId: c.id, title: c.title, tag: c.tag, endsAt: c.endsAt, winner: ranked[0] ?? null }
    }),
  )
}

export interface AdminChallengeDto extends ChallengeDto {
  status: 'upcoming' | 'active' | 'closed'
}

/** Every challenge, newest first — the admin list (unlike getActiveChallenge,
 *  not limited to the one window "now" falls in). */
export async function listAllChallenges(): Promise<AdminChallengeDto[]> {
  const now = new Date()
  interface Row {
    id: number
    title: string
    prompt: string
    tag: string | null
    startsAt: Date
    endsAt: Date
    _count: { submissions: number }
  }
  const rows: Row[] = await db.challenge.findMany({
    orderBy: { startsAt: 'desc' },
    include: { _count: { select: { submissions: true } } },
  })
  return rows.map((row: Row) => {
    const { _count, ...rest } = row
    const status = now < row.startsAt ? 'upcoming' : now > row.endsAt ? 'closed' : 'active'
    return { ...rest, submissionCount: _count.submissions, status }
  })
}

export class ChallengeError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Enter (or swap the entered board for) the active challenge. One entry per coach. */
export async function enterChallenge(challengeId: number, userId: number, boardId: number) {
  const now = new Date()
  const challenge = await db.challenge.findUnique({ where: { id: challengeId } })
  if (!challenge) throw new ChallengeError(404, 'Challenge not found')
  if (now < challenge.startsAt || now > challenge.endsAt) {
    throw new ChallengeError(400, "This challenge isn't open for entries right now")
  }
  const board = await db.canvasBoard.findFirst({ where: { id: boardId, userId } })
  if (!board) throw new ChallengeError(404, 'Board not found')
  if (!board.published) throw new ChallengeError(400, 'Publish this board before submitting it — other coaches need to be able to see it to vote')

  const submission = await db.challengeSubmission.upsert({
    where: { challengeId_userId: { challengeId, userId } },
    update: { boardId },
    create: { challengeId, userId, boardId },
    include: SUBMISSION_INCLUDE,
  })
  return toSubmissionDto(submission, userId)
}

/** Cast a ballot for a submission — one vote per coach per CHALLENGE, not per
 *  submission. Voting for a new entry moves the coach's existing vote off
 *  whatever else they'd backed in this challenge rather than stacking a
 *  second vote, so the response is the whole re-ranked leaderboard (two
 *  submissions' counts can change at once: the old pick loses a vote, the
 *  new one gains one). */
export async function castVote(submissionId: number, userId: number): Promise<SubmissionDto[]> {
  const submission = await db.challengeSubmission.findUnique({
    where: { id: submissionId },
    include: { challenge: true },
  })
  if (!submission) throw new ChallengeError(404, 'Submission not found')
  const now = new Date()
  if (now > submission.challenge.endsAt) throw new ChallengeError(400, 'Voting has closed for this challenge')
  if (submission.userId === userId) throw new ChallengeError(400, "You can't vote for your own submission")

  await db.$transaction([
    db.challengeVote.deleteMany({
      where: {
        userId,
        submissionId: { not: submissionId },
        submission: { challengeId: submission.challengeId },
      },
    }),
    db.challengeVote.upsert({
      where: { submissionId_userId: { submissionId, userId } },
      update: {},
      create: { submissionId, userId },
    }),
  ])

  return listSubmissions(submission.challengeId, userId)
}

export async function removeVote(submissionId: number, userId: number) {
  await db.challengeVote.deleteMany({ where: { submissionId, userId } })
  const voteCount = await db.challengeVote.count({ where: { submissionId } })
  return { voted: false, voteCount }
}
