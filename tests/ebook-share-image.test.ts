// SHARE-IMAGE (2 Oct 2026): a book link shows the book's own card.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp } from './helpers.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
beforeEach(() => { vi.clearAllMocks() })

const get = async (slug = 'pressing') => (await getApp()).inject({ method: 'GET', url: `/api/ebooks/${slug}/share.png` })

describe('SHARE-IMAGE · /api/ebooks/:slug/share.png', () => {
  it('redirects to a fresh presigned link to the card', async () => {
    mock.ebook.findFirst.mockResolvedValue({ shareImageKey: 'ebooks/5/share-1.png' } as never)
    const res = await get()
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://s3.test/ebooks/5/share-1.png?signed')
    expect(String(res.headers['cache-control'])).toContain('max-age=3600')
  })
  it('falls back to the site image when the book has none yet', async () => {
    mock.ebook.findFirst.mockResolvedValue({ shareImageKey: null } as never)
    const res = await get()
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/\/og-image\.png$/)
  })
  it('only published shop books — never a draft or a club book', async () => {
    mock.ebook.findFirst.mockResolvedValue(null as never)
    expect((await get()).statusCode).toBe(404)
    const where = (mock.ebook.findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ status: 'published', clubId: null })
  })
})
