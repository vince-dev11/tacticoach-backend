// Video lessons in books (2 Oct 2026): a YouTube or Vimeo LINK, never an
// arbitrary iframe. The block keeps provider + id; the reader builds the
// embed from those two, so a book can only ever play those two hosts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { parseVideoUrl, embedUrl, normaliseVideoBlock } from '../src/lib/video-link.js'

const getEntitlements = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/entitlements.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/entitlements.js')>()),
  getEntitlements,
}))
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

describe('VIDEO-1 · parseVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'vimeo', '76979871'],
    ['https://vimeo.com/channels/staffpicks/76979871', 'vimeo', '76979871'],
    ['https://player.vimeo.com/video/76979871', 'vimeo', '76979871'],
  ])('%s → %s %s', (url, provider, id) => {
    expect(parseVideoUrl(url)).toMatchObject({ provider, id })
  })
  it('keeps a start time', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.start).toBe(90)
  })
  it.each([
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@channel',
    'not a link',
    '',
  ])('refuses %s', (url) => {
    expect(parseVideoUrl(url)).toBeNull()
  })
  it('builds only privacy-enhanced YouTube or Vimeo embeds', () => {
    expect(embedUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ', start: 90 })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&start=90')
    expect(embedUrl({ provider: 'vimeo', id: '76979871' })).toBe('https://player.vimeo.com/video/76979871?dnt=1')
  })
  it('normalise keeps provider, id, title, caption and drops anything else', () => {
    const out = normaliseVideoBlock({ url: 'https://youtu.be/dQw4w9WgXcQ', title: ' Pressing ', caption: 'Watch the 6', html: '<iframe src=evil>' })
    expect(out).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'Pressing', caption: 'Watch the 6' })
  })
})

describe('VIDEO-2 · saving a chapter with a video block', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach' } as never)
    getEntitlements.mockResolvedValue({ editorAccess: true, playerAccess: false, plan: { id: 1, name: 'pro', slug: 'pro' }, viaClub: false, viaCollaboration: false, isClubOwner: false, subscriptionStatus: 'active', expiresAt: null, trialEndsAt: null })
    mock.ebook.findFirst.mockResolvedValue({ id: 5, authorId: 1, status: 'draft', clubId: null, chapters: [] } as never)
    mock.ebookChapter.findMany.mockResolvedValue([] as never)
    mock.ebookChapter.create.mockResolvedValue({ id: 9 } as never)
    mock.ebookBlock.create.mockResolvedValue({} as never)
    dbMock.$transaction.mockImplementation(async (fn: unknown) => (fn as () => Promise<unknown>)() as never)
  })
  const put = async (url: string) => {
    const app = await getApp()
    return app.inject({
      method: 'PUT', url: '/api/my-books/5/chapters', headers: authHeaders(await accessToken()),
      payload: { chapters: [{ title: 'Pressing triggers', blocks: [{ kind: 'video', data: { url, caption: 'Watch the 6' } }] }] },
    })
  }
  it('refuses a link that is not YouTube or Vimeo, with a sentence the coach can act on', async () => {
    const res = await put('https://evil.example/video')
    expect(res.statusCode).toBe(422)
    expect(res.body).toContain('Paste a YouTube or Vimeo link')
    expect(mock.ebookBlock.create).not.toHaveBeenCalled()
  })
  it('stores provider + id, not the raw markup', async () => {
    const res = await put('https://youtu.be/dQw4w9WgXcQ')
    expect(res.statusCode).toBeLessThan(300)
    const data = (mock.ebookBlock.create.mock.calls[0][0] as { data: { kind: string; data: Record<string, unknown> } }).data
    expect(data.kind).toBe('video')
    expect(data.data).toMatchObject({ provider: 'youtube', videoId: 'dQw4w9WgXcQ', caption: 'Watch the 6' })
  })
})
