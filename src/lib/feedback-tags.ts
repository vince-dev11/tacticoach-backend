// The vocabulary a coach taps when writing feedback to a player.
//
// Tags rather than free text alone, for three reasons:
//   - Speed. Two taps and a sentence is twenty seconds; a blank box is a
//     minute and a guilty conscience. The whole feature depends on a coach
//     being able to do four players between packing the cones away and
//     getting in the car.
//   - Aggregation. "Scanning, mentioned six times this season" is the
//     player's answer to "am I getting better?", and you cannot compute that
//     from prose.
//   - Translation. These are keys; the labels live in the locale files like
//     every other piece of copy. The coach's own sentence stays in whatever
//     language they wrote it.
//
// Grouped on the four-corner model English FA coaching already uses, so the
// words are ones a qualified coach recognises rather than ones we invented.
//
// Kept in code, not the database: adding a tag should be a deploy and a
// translation pass, not a migration. The database only ever stores the keys.

export const FEEDBACK_CORNERS = ['technical', 'tactical', 'physical', 'social'] as const
export type FeedbackCorner = (typeof FEEDBACK_CORNERS)[number]

export const FEEDBACK_TAGS: Record<FeedbackCorner, readonly string[]> = {
  technical: [
    'first_touch',
    'passing',
    'weak_foot',
    'finishing',
    'heading',
    'ball_striking',
    'dribbling',
    'crossing',
  ],
  tactical: [
    'scanning',
    'positioning',
    'decision_making',
    'pressing_trigger',
    'support_angle',
    'staying_onside',
    'switching_play',
    'defensive_shape',
  ],
  physical: ['work_rate', 'speed', 'recovery_runs', 'balance', 'strength', 'stamina'],
  social: [
    'communication',
    'leadership',
    'resilience',
    'coachability',
    'focus',
    'encouraging_others',
    'timekeeping',
  ],
}

/** Every valid tag key, flattened. */
export const ALL_FEEDBACK_TAGS: readonly string[] = FEEDBACK_CORNERS.flatMap(
  (corner) => FEEDBACK_TAGS[corner],
)

const TAG_SET = new Set(ALL_FEEDBACK_TAGS)

export function isFeedbackTag(tag: string): boolean {
  return TAG_SET.has(tag)
}

/**
 * Keep only tags we recognise, de-duplicated, capped.
 *
 * Unknown keys are dropped rather than rejected: a client one deploy behind
 * should not have its coach's note refused because we renamed a tag. The
 * sentence is the part that matters and it survives either way.
 */
export const MAX_TAGS_PER_LIST = 5

export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string' || !TAG_SET.has(tag) || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length === MAX_TAGS_PER_LIST) break
  }
  return out
}

/**
 * The same tag may appear as a strength for one player and a work-on for
 * another — one vocabulary, two lists. What it must NOT do is appear in both
 * lists of the same note, which reads as a coach who has not decided.
 */
export function splitTagLists(strengths: unknown, workOns: unknown): {
  strengths: string[]
  workOns: string[]
} {
  const s = cleanTags(strengths)
  const w = cleanTags(workOns).filter((tag) => !s.includes(tag))
  return { strengths: s, workOns: w }
}

/** How often each tag appears across a player's notes, most-mentioned first. */
export function tagFrequency(
  notes: { strengths: unknown; workOns: unknown }[],
): { strengths: [string, number][]; workOns: [string, number][] } {
  const count = (pick: (n: { strengths: unknown; workOns: unknown }) => unknown) => {
    const tally = new Map<string, number>()
    for (const note of notes) {
      for (const tag of cleanTags(pick(note))) {
        tally.set(tag, (tally.get(tag) ?? 0) + 1)
      }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }
  return { strengths: count((n) => n.strengths), workOns: count((n) => n.workOns) }
}
