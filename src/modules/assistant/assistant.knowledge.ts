// What the Ask assistant knows — and nothing else.
//
// Three sources, all coach-facing, none hand-written here except the policy
// facts:
//
//   1. The help pack the frontend build writes (dist/help-knowledge/<lang>.json):
//      every help topic with the real button names, plus recent release notes.
//      Fetched from the app and cached, so a new help topic is known on the
//      frontend's next deploy without touching the API.
//   2. Plans, live: the membership_plans table (names, prices) joined with
//      capabilities.ts (what each tier can do). A price changed in Admin is the
//      answer on the next question (5-minute cache).
//   3. Policy facts: the trial, refunds, players free, books 70/30. Short,
//      English (the model answers in the coach's language), and tied to
//      capabilities.ts by tests.
//
// The model only ever sees chunks from here and the coach's question. It never
// receives code, config, the database, other users or this account's data —
// which is the real guarantee behind "never show anything sensitive".

import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { capabilitiesOf, limitsOfPlan, type Capability } from '../../lib/capabilities.js'

export interface Chunk {
  id: string
  title: string
  text: string
  /** In-app link for "Sources". */
  url: string
}

export const ASSISTANT_LANGS = ['en', 'en-US', 'de', 'es', 'fr', 'it', 'pt', 'tr'] as const
export type AssistantLang = (typeof ASSISTANT_LANGS)[number]

// ---- 1. Help pack ----------------------------------------------------------

const PACK_TTL_MS = 60 * 60 * 1000
const packCache = new Map<string, { at: number; chunks: Chunk[] }>()

function packUrl(lang: string): string {
  const base = (env.HELP_KNOWLEDGE_URL ?? env.FRONTEND_URL).replace(/\/$/, '')
  return `${base}/help-knowledge/${lang}.json`
}

/** Only well-formed chunks with an in-app link survive. */
function cleanPack(raw: unknown): Chunk[] {
  const chunks = (raw as { chunks?: unknown })?.chunks
  if (!Array.isArray(chunks)) return []
  return chunks
    .filter((c): c is Chunk =>
      !!c && typeof c.id === 'string' && typeof c.title === 'string' &&
      typeof c.text === 'string' && typeof c.url === 'string' && c.url.startsWith('/'))
    .map((c) => ({ id: c.id, title: c.title.slice(0, 200), text: c.text.slice(0, 4000), url: c.url }))
}

export async function helpPack(lang: AssistantLang): Promise<Chunk[]> {
  const hit = packCache.get(lang)
  if (hit && Date.now() - hit.at < PACK_TTL_MS) return hit.chunks
  try {
    const res = await fetch(packUrl(lang), { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(String(res.status))
    const chunks = cleanPack(await res.json())
    if (chunks.length) {
      packCache.set(lang, { at: Date.now(), chunks })
      return chunks
    }
  } catch {
    // fall through: a stale copy beats nothing, and English beats nothing
  }
  if (hit) return hit.chunks
  return lang === 'en' ? [] : helpPack('en')
}

/** Tests only. */
export function _resetKnowledgeCache() {
  packCache.clear()
  plansCache = null
}

// ---- 2. Plans --------------------------------------------------------------

/** What a capability means to a coach. Every Capability must have a line (tested). */
export const CAPABILITY_WORDS: Record<Capability, string> = {
  editor: 'the tactics board (2D, Set up and Movement)',
  video_export: 'download animations as video',
  player_feedback: 'a squad and written feedback to players',
  video_hd: 'HD video without the TactiCoach badge',
  social_export: 'square and story clips for social media',
  planner: 'the session builder and season planner',
  multi_squad: 'more than one squad',
  own_branding: 'your own badge on sheets, shares and your page',
  guardian_copies: 'copies of feedback to parents',
  ai: 'AI help on the board',
  draft_ebooks: 'write a coaching book',
  publish_ebooks: 'publish and sell books (you keep 70%)',
  club_page: 'a public club page',
  board_3d: '3D and Stadium views',
  ball_sound: 'ball sounds in videos',
  connected_players: 'connected players',
  live_record: 'record yourself explaining a board (camera and voice), saved on your device',
}

const LIMIT_WORDS: Record<string, string> = {
  boards: 'boards', drillSheets: 'drill sheets', sessions: 'sessions', seasons: 'season plans',
  books: 'books', videoExports: 'videos', squads: 'squads', seats: 'coach seats',
}

const money = (v: unknown, currency: string) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : `${currency} `
  return `${sym}${n.toFixed(2)}`
}

const PLANS_TTL_MS = 5 * 60 * 1000
let plansCache: { at: number; chunks: Chunk[] } | null = null

export async function planChunks(): Promise<Chunk[]> {
  if (plansCache && Date.now() - plansCache.at < PLANS_TTL_MS) return plansCache.chunks
  const plans = await db.membershipPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { name: true, slug: true, monthlyPrice: true, annualPrice: true, currency: true },
  })
  const chunks = plans
    .filter((p) => p.slug !== 'player' && p.slug !== 'owner')
    .map((p) => {
      const caps = capabilitiesOf(p.slug).map((c) => CAPABILITY_WORDS[c]).filter(Boolean)
      const limits = limitsOfPlan(p.slug)
      const counted = limits
        ? Object.entries(limits)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => `${k === 'seats' ? '' : 'up to '}${v} ${LIMIT_WORDS[k] ?? k}`.trim())
        : []
      const monthly = money(p.monthlyPrice, p.currency)
      const annual = money(p.annualPrice, p.currency)
      const price = [monthly && `${monthly} a month`, annual && `${annual} a year`].filter(Boolean).join(' or ')
      return {
        id: `plan:${p.slug}`,
        title: `${p.name} plan`,
        text: [
          `${p.name} plan${price ? `: ${price}` : ''}.`,
          caps.length ? `Includes: ${caps.join('; ')}.` : '',
          counted.length ? `Limits: ${counted.join(', ')}.` : 'No count limits.',
        ].filter(Boolean).join('\n'),
        url: '/pricing',
      }
    })
  plansCache = { at: Date.now(), chunks }
  return chunks
}

// ---- 3. Policy facts ---------------------------------------------------------

export const POLICY_CHUNKS: Chunk[] = [
  {
    id: 'policy:trial',
    title: 'Free trial',
    text: 'New coaches get a 14-day free trial with no card. It shows the Pro board in small counts. After 14 days the coach keeps read access to their work and chooses Basic or Pro to keep building.',
    url: '/help/account#planTrial',
  },
  {
    id: 'policy:refunds',
    title: 'Refunds and cancelling',
    text: 'Subscriptions: a full refund if the coach asks within 14 days of their first payment, no refund after that. Cancelling keeps the plan until the end of the paid period. Refunds are requested through the Contact page; the assistant cannot make refunds or change plans.',
    url: '/help/account#planBilling',
  },
  {
    id: 'policy:players',
    title: 'Players are free',
    text: 'Player accounts are free. Players see only their coach\'s feedback and books. Players under 18 need a parent; under 13 have no login of their own; players under 18 never see prices.',
    url: '/help/account#familyAccounts',
  },
  {
    id: 'policy:books',
    title: 'Selling books',
    text: 'Books are bought once. The author keeps 70% of each sale and TactiCoach keeps 30%. Publishing a book needs the Pro plan or a club plan.',
    url: '/help/books',
  },
  {
    id: 'policy:prices',
    title: 'Prices',
    text: 'Prices are shown in pounds on the pricing page. Clubs choose a size (number of coach seats); every seat gets Pro.',
    url: '/pricing',
  },
]

export async function allChunks(lang: AssistantLang): Promise<Chunk[]> {
  const [help, plans] = await Promise.all([helpPack(lang), planChunks().catch(() => [] as Chunk[])])
  return [...help, ...plans, ...POLICY_CHUNKS]
}
