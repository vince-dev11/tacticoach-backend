// Public share endpoints — read-only views of PUBLISHED content, no login
// needed. These power the /share/board/:id and /share/sheet/:id pages that
// coaches send to players and parents. Editing/deleting stays with the owner
// through the authenticated canvas/drill-sheet routes (ownership is checked
// in every write query there).

import type { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'
import { clubBrandingActive } from '../../lib/entitlements.js'
import { coachStripFor } from '../coach-page/coach-page.service.js'

/** Brand strip for the author's club (own club or via seat), when branded. */
async function clubStripFor(userId: number) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ownedClub: { select: { ownerId: true, name: true, badgeKey: true, primaryColor: true, slug: true, pageStatus: true } },
      clubMembership: { select: { club: { select: { ownerId: true, name: true, badgeKey: true, primaryColor: true, slug: true, pageStatus: true } } } },
    },
  })
  const club = user?.ownedClub ?? user?.clubMembership?.club ?? null
  if (!club || !club.badgeKey) return null
  // Branding rides on the owner's subscription — lapsed plan, no brand strip.
  if (!(await clubBrandingActive(club.ownerId))) return null
  return {
    name: club.name,
    badgeUrl: await presignUrl(club.badgeKey),
    primaryColor: club.primaryColor,
    // Only link to the public page once it's approved.
    slug: club.pageStatus === 'approved' ? club.slug : null,
  }
}

/**
 * A saved board with every player's name removed (LIVE-3D, 9 Oct 2026).
 * A player object (`tcType` or `type` "player") carries its squad name in
 * `tcProps.name` (the editor's saved shape) or `props.name`; both are
 * dropped wherever a player object appears (the canvas and any frame
 * snapshot). Everything else — a zone's name, the shirt numbers — stays.
 */
/** The boards a published sheet shows (names removed) and their captions. */
export function sheetBoards(data: unknown): { board: unknown; caption: string }[] {
  if (!data || typeof data !== 'object') return []
  const d = data as { boards?: unknown; layout?: unknown; captions?: unknown; board?: unknown; board2?: unknown }
  const list = Array.isArray(d.boards)
    ? d.boards.slice(0, typeof d.layout === 'number' ? Math.max(0, Math.min(8, d.layout)) : d.boards.length)
    : [d.board, d.board2]
  const captions = Array.isArray(d.captions) ? d.captions : []
  return list
    .map((b, i) => ({ b, caption: typeof captions[i] === 'string' ? (captions[i] as string).slice(0, 40) : '' }))
    .filter(({ b }) => !!b && typeof b === 'object')
    .map(({ b, caption }) => ({ board: withoutPlayerNames(b), caption }))
}

export function withoutPlayerNames(state: unknown): unknown {
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk)
    if (!o || typeof o !== 'object') return o
    const src = o as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src)) out[k] = walk(v)
    if (src.tcType === 'player' || src.type === 'player') {
      for (const key of ['tcProps', 'props']) {
        const p = out[key]
        if (p && typeof p === 'object' && !Array.isArray(p) && 'name' in (p as object)) {
          const { name: _drop, ...rest } = p as Record<string, unknown>
          void _drop
          out[key] = rest
        }
      }
    }
    return out
  }
  return walk(state)
}

/** KIDS: a saved board's main message for players (tcMeta.playerMessage), or ''. */
export function boardPlayerMessage(state: unknown): string {
  const meta = (state as { canvas?: { tcMeta?: { playerMessage?: unknown } } } | null)?.canvas?.tcMeta
  return typeof meta?.playerMessage === 'string' ? meta.playerMessage.trim().slice(0, 160) : ''
}

const PREVIEW_TOKEN = /^[A-Za-z0-9_-]{16,32}$/
type PreviewBlock = { kind?: unknown; refId?: unknown; title?: unknown; minutes?: unknown; keyPoint?: unknown; board?: unknown }

/**
 * KIDS (26 Oct 2026): what a session's parents' preview shows — and nothing
 * more. Per practice: its name, minutes, the one line to remember and the
 * moving board (names removed). Coaching points, organisation, the squad,
 * notes and match details stay with the coach. Notes ("text" blocks) are
 * left out: they are the coach's own reminders.
 */
export async function previewPractices(userId: number, blocks: unknown) {
  const list = (Array.isArray(blocks) ? (blocks as PreviewBlock[]) : []).filter((b) => b && b.kind !== 'text').slice(0, 12)
  const boardIds = list.filter((b) => b.kind === 'board' && !b.board && typeof b.refId === 'number').map((b) => b.refId as number)
  const sheetIds = list.filter((b) => b.kind === 'sheet' && !b.board && typeof b.refId === 'number').map((b) => b.refId as number)
  // Only the coach's own library items — a block can never pull someone else's board.
  const [boards, sheets] = await Promise.all([
    boardIds.length ? db.canvasBoard.findMany({ where: { id: { in: boardIds }, userId }, select: { id: true, state: true } }) : [],
    sheetIds.length ? db.drillSheet.findMany({ where: { id: { in: sheetIds }, userId }, select: { id: true, data: true } }) : [],
  ])
  return list.map((b) => {
    let board: unknown = b.board ?? null
    let sheetMessage = ''
    if (!board && b.kind === 'board') board = boards.find((x) => x.id === b.refId)?.state ?? null
    if (!board && b.kind === 'sheet') {
      const sheet = sheets.find((x) => x.id === b.refId)
      board = sheet ? sheetBoards(sheet.data)[0]?.board ?? null : null
      const meta = (sheet?.data as { meta?: { keyPoint?: unknown } } | undefined)?.meta
      sheetMessage = typeof meta?.keyPoint === 'string' ? meta.keyPoint.trim().slice(0, 160) : ''
    }
    const own = typeof b.keyPoint === 'string' ? b.keyPoint.trim().slice(0, 160) : ''
    return {
      title: typeof b.title === 'string' ? b.title.slice(0, 255) : '',
      minutes: typeof b.minutes === 'number' ? b.minutes : null,
      message: own || sheetMessage || boardPlayerMessage(board),
      board: board ? withoutPlayerNames(board) : null,
    }
  })
}

export async function shareRoutes(app: FastifyInstance) {
  // GET /share/session/:token — KIDS: the parents' preview of a session. Public
  // by its unguessable link; switched off (token cleared) = 404 for everyone.
  app.get('/session/:token', async (request, reply) => {
    const token = (request.params as { token: string }).token
    const notFound = () => reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This session preview is not available' })
    if (!PREVIEW_TOKEN.test(token)) return notFound()
    const session = await db.trainingSession.findFirst({
      where: { previewToken: token },
      select: {
        userId: true, title: true, description: true, sessionDate: true, previewQuestion: true, blocks: true,
        user: { select: { name: true, surname: true, clubName: true } },
      },
    })
    if (!session) return notFound()
    return reply.send({
      title: session.title,
      aim: session.description ?? null,
      sessionDate: session.sessionDate,
      question: session.previewQuestion ?? null,
      coach: `${session.user.name} ${session.user.surname}`.trim(),
      clubName: session.user.clubName,
      practices: await previewPractices(session.userId, session.blocks),
      club: await clubStripFor(session.userId),
    })
  })

  // GET /share/board/:id — a published board's video/thumbnail + attribution
  app.get('/board/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const board = await db.canvasBoard.findFirst({
      where: { id, published: true },
      select: {
        id: true,
        userId: true,
        title: true,
        publishedAt: true,
        thumbnailKey: true,
        videoKey: true,
        state: true,
        user: { select: { name: true, surname: true, clubName: true } },
        _count: { select: { likes: true } },
      },
    })
    if (!board) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This board is not available' })
    }
    const [thumbnailUrl, videoUrl] = await Promise.all([
      board.thumbnailKey ? presignUrl(board.thumbnailKey) : Promise.resolve(null),
      board.videoKey ? presignUrl(board.videoKey) : Promise.resolve(null),
    ])
    return reply.send({
      id: board.id,
      title: board.title,
      publishedAt: board.publishedAt,
      author: `${board.user.name} ${board.user.surname}`.trim(),
      clubName: board.user.clubName,
      likeCount: board._count.likes,
      thumbnailUrl,
      videoUrl,
      // LIVE-3D: the board itself, played live on the page instead of a
      // stored video — with the players' names taken out. A shared link can
      // reach anyone, and a name on a token may be a child's; the shirt
      // numbers stay.
      state: withoutPlayerNames(board.state),
      club: await clubStripFor(board.userId),
      coach: await coachStripFor(board.userId),
    })
  })

  // GET /share/sheet/:id — a published drill sheet's rendered image + meta
  app.get('/sheet/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const sheet = await db.drillSheet.findFirst({
      where: { id, published: true },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        publishedAt: true,
        imageKey: true,
        data: true,
        user: { select: { name: true, surname: true, clubName: true } },
      },
    })
    if (!sheet) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This drill sheet is not available' })
    }
    return reply.send({
      id: sheet.id,
      title: sheet.title,
      description: sheet.description,
      publishedAt: sheet.publishedAt,
      author: `${sheet.user.name} ${sheet.user.surname}`.trim(),
      clubName: sheet.user.clubName,
      imageUrl: sheet.imageKey ? await presignUrl(sheet.imageKey) : null,
      // SHEET-WATCH (12 Oct 2026): the sheet's boards, so the page (and the QR
      // code printed on the sheet) can PLAY the moves. Names taken out, as on
      // a shared board; only the boards the sheet shows, with their captions.
      // Never the rest of `data` — it holds the coach's private notes.
      boards: sheetBoards(sheet.data),
      club: await clubStripFor(sheet.userId),
      coach: await coachStripFor(sheet.userId),
    })
  })
}
