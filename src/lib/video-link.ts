// Video links in books (video block, 2 Oct 2026).
//
// A coach pastes a YouTube or Vimeo link; we keep only the provider and the
// video id, and build the embed URL ourselves. Nothing else from the link is
// trusted — no arbitrary iframe src, no other hosts — so a block can never
// point the reader's browser at a page we did not choose.
//
// Mirrored in tacticoach-frontend/src/lib/videoLink.ts (same cases, same tests).

export type VideoProvider = 'youtube' | 'vimeo'
export type VideoRef = { provider: VideoProvider; id: string; start?: number }

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{6,12}$/

/** "1m30s", "90", "90s" → seconds. */
function seconds(t: string | null): number | undefined {
  if (!t) return undefined
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  if (!m || !t) return undefined
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return s > 0 ? s : undefined
}

export function parseVideoUrl(raw: string): VideoRef | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^www\.|^m\./, '')
  const path = url.pathname.split('/').filter(Boolean)
  const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'))

  let id: string | undefined
  if (host === 'youtu.be') id = path[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (path[0] === 'watch') id = url.searchParams.get('v') ?? undefined
    else if (['shorts', 'embed', 'live', 'v'].includes(path[0] ?? '')) id = path[1]
  }
  if (id !== undefined) return YT_ID.test(id) ? { provider: 'youtube', id, ...(start ? { start } : {}) } : null

  if (host === 'vimeo.com') id = path.find((p) => VIMEO_ID.test(p))
  else if (host === 'player.vimeo.com' && path[0] === 'video') id = path[1]
  if (id !== undefined) return VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null

  return null
}

/** The only iframe src a video block can produce. */
export function embedUrl(v: VideoRef): string {
  if (v.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1${v.start ? `&start=${v.start}` : ''}`
  }
  return `https://player.vimeo.com/video/${v.id}?dnt=1`
}

export const VIDEO_LINK_ERROR = 'Paste a YouTube or Vimeo link, e.g. https://youtu.be/… or https://vimeo.com/…'

/**
 * Normalise a video block's data on save: keep provider + id (+ start), the
 * coach's caption and title, drop everything else. Returns null when the link
 * is not a YouTube or Vimeo video.
 */
export function normaliseVideoBlock(data: Record<string, unknown>): Record<string, unknown> | null {
  const url = typeof data.url === 'string' ? data.url : ''
  const ref = parseVideoUrl(url)
  if (!ref) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  return {
    url: url.trim().slice(0, 500),
    provider: ref.provider,
    videoId: ref.id,
    ...(ref.start ? { start: ref.start } : {}),
    title: text(data.title, 160),
    caption: text(data.caption, 400),
  }
}

/** zod superRefine for a book block: a video block must carry a usable link. */
export function refineVideoBlock(
  b: { kind: string; data: Record<string, unknown> },
  ctx: { addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void },
): void {
  if (b.kind === 'video' && !parseVideoUrl(typeof b.data.url === 'string' ? b.data.url : '')) {
    ctx.addIssue({ code: 'custom', path: ['data', 'url'], message: VIDEO_LINK_ERROR })
  }
}
