// Every feedback tag must have an English label, because the one place the
// SERVER renders a tag is the email that goes to a child and their parent.
//
// The failure this guards against is silent and embarrassing rather than
// loud: add 'body_shape' to feedback-tags.ts, forget this map, and a parent
// opens an email that says their daughter is working on "body shape" in
// lower-case slug form — or worse, "weak_foot". The app itself would be fine,
// because its labels come from the locale files.

import { describe, it, expect } from 'vitest'
import { ALL_FEEDBACK_TAGS } from '../src/lib/feedback-tags.js'
import { tagLabel, UNLABELLED_TAGS } from '../src/lib/feedback-tag-labels.js'

describe('feedback tag labels', () => {
  it('labels every tag in the vocabulary', () => {
    // Named in the failure rather than just a count, so the fix is obvious.
    expect(UNLABELLED_TAGS).toEqual([])
  })

  it('renders human labels, never the raw key', () => {
    expect(tagLabel('first_touch')).toBe('First touch')
    expect(tagLabel('decision_making')).toBe('Decision making')
    for (const tag of ALL_FEEDBACK_TAGS) {
      expect(tagLabel(tag)).not.toContain('_')
    }
  })

  it('de-slugs an unknown tag rather than leaking the key', () => {
    // A client one deploy ahead can send a tag this build has never heard of.
    // cleanTags drops those before they are stored, so this is belt and
    // braces — but "Body shape" is a better failure than "body_shape".
    expect(tagLabel('body_shape')).toBe('Body shape')
    expect(tagLabel('')).toBe('')
  })
})
