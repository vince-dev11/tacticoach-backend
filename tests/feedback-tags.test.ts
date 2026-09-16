// The tag vocabulary a coach taps when writing to a player.
//
// Tags are the reason a note takes twenty seconds instead of a minute, and the
// reason a season summary is computable at all. These tests guard the two
// properties that make both true: only known keys are stored, and the same tag
// never lands in both lists of one note.

import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_CORNERS,
  FEEDBACK_TAGS,
  ALL_FEEDBACK_TAGS,
  MAX_TAGS_PER_LIST,
  isFeedbackTag,
  cleanTags,
  splitTagLists,
  tagFrequency,
} from '../src/lib/feedback-tags.js'

describe('the vocabulary', () => {
  it('covers all four corners', () => {
    expect(FEEDBACK_CORNERS).toEqual(['technical', 'tactical', 'physical', 'social'])
    for (const corner of FEEDBACK_CORNERS) {
      expect(FEEDBACK_TAGS[corner].length, corner).toBeGreaterThan(3)
    }
  })

  it('has no duplicate keys across corners', () => {
    // A tag in two corners would be counted twice in a season summary.
    expect(new Set(ALL_FEEDBACK_TAGS).size).toBe(ALL_FEEDBACK_TAGS.length)
  })

  it('uses snake_case keys, never display text', () => {
    // These are translated in the locale files; a space here means someone
    // typed a label into the vocabulary by mistake.
    for (const tag of ALL_FEEDBACK_TAGS) {
      expect(tag, tag).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe('cleanTags', () => {
  it('keeps known tags in the order given', () => {
    expect(cleanTags(['scanning', 'first_touch'])).toEqual(['scanning', 'first_touch'])
  })

  it('drops unknown keys rather than rejecting the note', () => {
    // A client one deploy behind must not get a coach's note refused because
    // we renamed a tag. The sentence is what matters.
    expect(cleanTags(['scanning', 'telekinesis'])).toEqual(['scanning'])
  })

  it('de-duplicates', () => {
    expect(cleanTags(['scanning', 'scanning'])).toEqual(['scanning'])
  })

  it('caps the list', () => {
    expect(cleanTags(ALL_FEEDBACK_TAGS).length).toBe(MAX_TAGS_PER_LIST)
  })

  it.each([null, undefined, 'scanning', 42, {}])('returns [] for %p', (input) => {
    expect(cleanTags(input)).toEqual([])
  })

  it('ignores non-string members', () => {
    expect(cleanTags(['scanning', 7, null])).toEqual(['scanning'])
  })
})

describe('splitTagLists', () => {
  it('lets one tag be a strength for one player and a work-on for another', () => {
    // One vocabulary, two lists — that is the whole point.
    expect(splitTagLists(['weak_foot'], []).strengths).toEqual(['weak_foot'])
    expect(splitTagLists([], ['weak_foot']).workOns).toEqual(['weak_foot'])
  })

  it('refuses the same tag in both lists of one note', () => {
    // "Good at scanning / work on scanning" reads as a coach who has not
    // decided. The strength wins; the work-on is dropped.
    const { strengths, workOns } = splitTagLists(['scanning', 'passing'], ['scanning', 'weak_foot'])
    expect(strengths).toEqual(['scanning', 'passing'])
    expect(workOns).toEqual(['weak_foot'])
  })
})

describe('tagFrequency', () => {
  const notes = [
    { strengths: ['scanning', 'first_touch'], workOns: ['weak_foot'] },
    { strengths: ['scanning'], workOns: ['weak_foot'] },
    { strengths: ['scanning'], workOns: ['passing'] },
  ]

  it('counts most-mentioned first — the "am I getting better?" answer', () => {
    const { strengths, workOns } = tagFrequency(notes)
    expect(strengths[0]).toEqual(['scanning', 3])
    expect(workOns[0]).toEqual(['weak_foot', 2])
  })

  it('breaks ties alphabetically so the order is stable between loads', () => {
    const { strengths } = tagFrequency([{ strengths: ['passing', 'first_touch'], workOns: [] }])
    expect(strengths.map(([tag]) => tag)).toEqual(['first_touch', 'passing'])
  })

  it('survives junk in stored rows', () => {
    expect(() => tagFrequency([{ strengths: null, workOns: 'nope' }])).not.toThrow()
  })
})

describe('isFeedbackTag', () => {
  it.each(['scanning', 'weak_foot', 'leadership'])('accepts %s', (tag) => {
    expect(isFeedbackTag(tag)).toBe(true)
  })

  it.each(['', 'Scanning', 'weak foot', 'unknown'])('rejects %p', (tag) => {
    expect(isFeedbackTag(tag)).toBe(false)
  })
})
