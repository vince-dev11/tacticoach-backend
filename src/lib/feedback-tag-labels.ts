// English display labels for the feedback tags.
//
// The app's own labels live in the locale files and are translated eleven ways
// — the tags themselves are only keys (see lib/feedback-tags). Email is the one
// place the server has to render them itself, and the server has no locale to
// render them in: User carries no language column, so every transactional email
// this product sends is English. Rather than pretend otherwise, this is an
// explicit English-only map, and the day a `language` column exists this file
// becomes the `en` entry in a bigger one.
//
// Kept SEPARATE from feedback-tags.ts on purpose. That file is the vocabulary
// and is imported by validation on the hot path; this one is presentation and
// is imported by exactly one email. Nothing that validates a note should have
// to load display strings.

import { ALL_FEEDBACK_TAGS } from './feedback-tags.js'

const LABELS: Record<string, string> = {
  // Technical
  first_touch: 'First touch',
  passing: 'Passing',
  weak_foot: 'Weak foot',
  finishing: 'Finishing',
  heading: 'Heading',
  ball_striking: 'Ball striking',
  dribbling: 'Dribbling',
  crossing: 'Crossing',
  // Tactical
  scanning: 'Scanning',
  positioning: 'Positioning',
  decision_making: 'Decision making',
  pressing_trigger: 'Pressing triggers',
  support_angle: 'Support angles',
  staying_onside: 'Staying onside',
  switching_play: 'Switching play',
  defensive_shape: 'Defensive shape',
  // Physical
  work_rate: 'Work rate',
  speed: 'Speed',
  recovery_runs: 'Recovery runs',
  balance: 'Balance',
  strength: 'Strength',
  stamina: 'Stamina',
  // Social
  communication: 'Communication',
  leadership: 'Leadership',
  resilience: 'Resilience',
  coachability: 'Coachability',
  focus: 'Focus',
  encouraging_others: 'Encouraging others',
  timekeeping: 'Timekeeping',
}

/**
 * A tag's English label.
 *
 * Falls back to a de-slugged version of the key rather than the raw key or an
 * empty string. A tag added to feedback-tags.ts and forgotten here then reads
 * "Weak foot" instead of "weak_foot" in a child's email — wrong-ish, never
 * broken. The test alongside this file fails the build in that case anyway, so
 * the fallback is a safety net and not a licence to skip the map.
 */
export function tagLabel(tag: string): string {
  const known = LABELS[tag]
  if (known) return known
  const words = tag.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

/** Every tag has a label. Exported so the test can assert it rather than guess. */
export const UNLABELLED_TAGS: readonly string[] = ALL_FEEDBACK_TAGS.filter((tag) => !LABELS[tag])
