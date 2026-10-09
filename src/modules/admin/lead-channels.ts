// Where a lead heard about TactiCoach (6 Oct 2026). Kept as a list in code,
// not a database enum, so adding one is a one-line change. The admin UI
// mirrors this list in src/lib/admin.ts (LEAD_CHANNELS).
export const LEAD_CHANNELS = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'linkedin',
  'whatsapp',
  'google',
  'word_of_mouth',
  'event',
  'email',
  'other',
] as const

export type LeadChannel = (typeof LEAD_CHANNELS)[number]

/**
 * A spreadsheet cell or a typed value → a channel. Lenient on purpose: people
 * write "Insta", "FB", "Twitter", "Friend". Unknown text → 'other' rather than
 * a rejected row; empty → null.
 */
export function normaliseChannel(raw: unknown): LeadChannel | null {
  if (raw == null) return null
  const v = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!v) return null
  if ((LEAD_CHANNELS as readonly string[]).includes(v)) return v as LeadChannel
  const alias: Record<string, LeadChannel> = {
    fb: 'facebook', meta: 'facebook', insta: 'instagram', ig: 'instagram',
    tik_tok: 'tiktok', yt: 'youtube', twitter: 'x', linked_in: 'linkedin',
    wa: 'whatsapp', search: 'google', google_search: 'google',
    referral: 'word_of_mouth', friend: 'word_of_mouth', word_of_mouth_: 'word_of_mouth',
    wom: 'word_of_mouth', club: 'word_of_mouth', newsletter: 'email', mail: 'email',
    show: 'event', conference: 'event', course: 'event',
  }
  return alias[v] ?? 'other'
}
