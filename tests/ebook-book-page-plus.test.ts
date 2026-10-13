// BOOK-SEARCH / BOOK-PAGE (12 Oct 2026)
//   - search inside a book names a chapter the reader can't open yet but never
//     quotes it (the words are what they would be paying for)
//   - "What you'll learn" is at most six short lines, whatever was stored

import { describe, it, expect, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { searchBook, cleanOutcomes } from '../src/modules/ebooks/ebooks.service.js'

const mock = dbMock as unknown as Record<string, Record<string, { mockResolvedValue: (v: unknown) => void }>>

const chapters = [
  { id: 1, title: 'Why press', isSample: true, blocks: [{ kind: 'text', data: { text: 'The trigger is a bad touch by the full back.' } }] },
  { id: 2, title: 'Pressing traps', isSample: false, blocks: [{ kind: 'text', data: { text: 'Show them inside, then the trigger is the backward pass.' } }] },
  { id: 3, title: 'Quiz', isSample: false, blocks: [{ kind: 'quiz', data: { question: 'trigger?', correct: 'trigger' } }] },
]

beforeEach(() => {
  mock.ebookChapter.findMany.mockResolvedValue(chapters)
})

describe('BOOK-SEARCH · search inside a book', () => {
  it('a paid book, not bought: the sample is quoted, a locked chapter is named only', async () => {
    mock.ebook.findFirst.mockResolvedValue({ id: 9, pricePence: 499, authorId: 2, clubId: null, clubAudience: null })
    const hits = await searchBook('pressing', 'trigger')
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ chapterId: 1, locked: false })
    expect(hits[0].snippet).toContain('trigger')
    expect(hits[1]).toEqual({ chapterId: 2, title: 'Pressing traps', snippet: '', locked: true })
  })

  it('a free book quotes every chapter; quiz answers are never searched', async () => {
    mock.ebook.findFirst.mockResolvedValue({ id: 9, pricePence: 0, authorId: 2, clubId: null, clubAudience: null })
    const hits = await searchBook('pressing', 'trigger')
    expect(hits.map((h) => h.chapterId)).toEqual([1, 2])
    expect(hits[1].snippet).toContain('backward pass')
  })

  it('one letter or an unpublished book finds nothing', async () => {
    expect(await searchBook('pressing', 't')).toEqual([])
    mock.ebook.findFirst.mockResolvedValue(null)
    expect(await searchBook('pressing', 'trigger')).toEqual([])
  })
})

describe('BOOK-PAGE · What you\'ll learn', () => {
  it('keeps up to six non-empty strings, trimmed and capped', () => {
    expect(cleanOutcomes(null)).toEqual([])
    expect(cleanOutcomes(['  a ', '', 3, 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(cleanOutcomes(['x'.repeat(300)])[0]).toHaveLength(140)
  })
})
