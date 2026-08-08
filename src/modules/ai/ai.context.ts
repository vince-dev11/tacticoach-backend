// ai.context — who the session is actually for.
//
// Until now the generator received exactly two things: the coach's sentence and
// the board dimensions. It had no idea whether the session was for eight-year-
// olds or a senior side, which meant it could not tell the difference between a
// good answer and an impossible one. "4-3-3 high press" for an under-9 team is
// not a stylistic mismatch — under-9s play 7v7, so eleven players is impossible
// before tactics enter the conversation, and a sustained coordinated press is
// beyond what the age can execute or is being taught.
//
// Age is the key that unlocks the rest: it fixes the playing format, the format
// fixes the squad size and the pitch, and the age also sets how fast anyone can
// actually move. Encoding that here means the knowledge is inspectable and
// testable, rather than buried in prompt wording and hoped for.
//
// Formats follow the English FA's youth football rules, which are the most
// widely adopted and match the mini-soccer pitch the editor draws.

export type AgeGroup = 'u7' | 'u9' | 'u11' | 'u13' | 'u15' | 'u17' | 'senior'
export type PlayFormat = '5v5' | '7v7' | '9v9' | '11v11'
export type CoachLevel = 'grassroots' | 'academy' | 'semi_pro' | 'professional'

export interface CoachContext {
  age: AgeGroup
  format: PlayFormat
  level: CoachLevel
}

/** What the model may assume when a coach has told us nothing at all. */
export const DEFAULT_CONTEXT: CoachContext = { age: 'senior', format: '11v11', level: 'grassroots' }

export interface AgeProfile {
  label: string
  /** The format this age plays by default (a coach may still override it). */
  format: PlayFormat
  /**
   * Fastest a player of this age is animated at, m/s. An under-9 does not run
   * at an adult's pace, and an animation that says otherwise is teaching the
   * coach something false about the distances involved.
   */
  runSpeed: number
  /** Concepts that are inappropriate at this age, with the reason to say so. */
  disallowedConcepts: Record<string, string>
  /** How many distinct phases a session at this age should hold. */
  maxPhases: number
  /** One line of coaching context, injected into the brief. */
  emphasis: string
}

export const AGE_PROFILES: Record<AgeGroup, AgeProfile> = {
  u7: {
    label: 'Under 7',
    format: '5v5',
    runSpeed: 3.5,
    maxPhases: 2,
    emphasis:
      'Everything is about touches on the ball and having fun. No team shape, no pressing schemes, no positional discipline — at this age players follow the ball and that is correct.',
    disallowedConcepts: {
      high_press: 'coordinated pressing is years beyond this age — they should be dribbling',
      counterpress: 'requires collective understanding that does not exist yet',
      defending_block: 'organised block defending is not taught at under-7',
      set_piece_corner: 'attacking set-piece routines are not appropriate here',
      set_piece_free_kick: 'attacking set-piece routines are not appropriate here',
      build_up: 'structured build-up requires positional understanding they have not been taught',
    },
  },
  u9: {
    label: 'Under 9',
    format: '7v7',
    runSpeed: 4.5,
    maxPhases: 3,
    emphasis:
      'Dribbling, first touch and simple two-player combinations. Introduce the idea of spreading out, but do not coach a shape.',
    disallowedConcepts: {
      high_press: 'a sustained coordinated press is beyond this age group',
      counterpress: 'counter-pressing requires collective triggers they cannot yet hold',
      defending_block: 'organised block defending is not appropriate at under-9',
    },
  },
  u11: {
    label: 'Under 11',
    format: '9v9',
    runSpeed: 5.5,
    maxPhases: 3,
    emphasis:
      'Combination play in small groups, when to pass and when to dribble, and the first ideas of width and support.',
    disallowedConcepts: {
      counterpress: 'immediate counter-pressing is a later concept; teach recovery runs first',
    },
    },
  u13: {
    label: 'Under 13',
    format: '11v11',
    runSpeed: 6,
    maxPhases: 4,
    emphasis:
      'The first full-pitch year. Positions, basic shape in and out of possession, and the principles behind them.',
    disallowedConcepts: {},
  },
  u15: {
    label: 'Under 15',
    format: '11v11',
    runSpeed: 6.5,
    maxPhases: 5,
    emphasis: 'Unit play, pressing triggers, and switching between phases of the game.',
    disallowedConcepts: {},
  },
  u17: {
    label: 'Under 17',
    format: '11v11',
    runSpeed: 7,
    maxPhases: 5,
    emphasis: 'Full tactical detail: pressing schemes, build-up patterns, game management.',
    disallowedConcepts: {},
  },
  senior: {
    label: 'Senior',
    format: '11v11',
    runSpeed: 7,
    maxPhases: 6,
    emphasis: 'Full tactical detail, opposition-specific planning and set-piece routines.',
    disallowedConcepts: {},
  },
}

export interface FormatProfile {
  label: string
  /** Outfield players plus keeper, per team. The hard ceiling on player count. */
  perTeam: number
  /** Editor pitch key this format is played on. */
  pitchKey: string | null
  /** Whether the format uses goalkeepers at all. */
  keepers: boolean
}

export const FORMAT_PROFILES: Record<PlayFormat, FormatProfile> = {
  // 5v5 mini-soccer has no dedicated keeper in many FA formats, but boards are
  // clearer with one, so we allow rather than require it.
  '5v5': { label: '5-a-side', perTeam: 5, pitchKey: 'pitch_4', keepers: true },
  '7v7': { label: '7-a-side', perTeam: 7, pitchKey: 'pitch_4', keepers: true },
  '9v9': { label: '9-a-side', perTeam: 9, pitchKey: 'classic', keepers: true },
  '11v11': { label: '11-a-side', perTeam: 11, pitchKey: 'classic', keepers: true },
}

export const LEVEL_LABELS: Record<CoachLevel, string> = {
  grassroots: 'Grassroots',
  academy: 'Academy',
  semi_pro: 'Semi-professional',
  professional: 'Professional',
}

const AGES = Object.keys(AGE_PROFILES) as AgeGroup[]
const FORMATS = Object.keys(FORMAT_PROFILES) as PlayFormat[]
const LEVELS = Object.keys(LEVEL_LABELS) as CoachLevel[]

export function isAgeGroup(v: unknown): v is AgeGroup {
  return typeof v === 'string' && AGES.includes(v as AgeGroup)
}
export function isPlayFormat(v: unknown): v is PlayFormat {
  return typeof v === 'string' && FORMATS.includes(v as PlayFormat)
}
export function isCoachLevel(v: unknown): v is CoachLevel {
  return typeof v === 'string' && LEVELS.includes(v as CoachLevel)
}

/**
 * Context as it arrives from the wire or the database: three optional strings,
 * none of them trusted. Every value is checked before use, so an old client, a
 * hand-rolled API call or a row written before an age group was renamed all
 * degrade to the default instead of failing the request.
 */
export interface LooseContext {
  age?: string | null
  format?: string | null
  level?: string | null
}

/**
 * Settle on the context for one generation.
 *
 * Precedence is request → saved profile → default. The per-request values come
 * from the override row in the AI panel: a coach who normally works with an
 * under-13 side but is covering a senior session tonight should not have to
 * edit their profile to get a sensible answer.
 *
 * Format follows the age unless it was chosen explicitly, so picking "under 9"
 * gives 7v7 without a second question — but a coach running 9v9 at under-9,
 * which happens, can still say so.
 */
export function resolveContext(
  request: LooseContext | undefined,
  profile: LooseContext | undefined,
): CoachContext {
  const age = isAgeGroup(request?.age)
    ? request.age
    : isAgeGroup(profile?.age)
      ? profile.age
      : DEFAULT_CONTEXT.age
  const explicitFormat = isPlayFormat(request?.format)
    ? request.format
    : isPlayFormat(profile?.format) && !isAgeGroup(request?.age)
      ? profile.format
      : undefined
  const level = isCoachLevel(request?.level)
    ? request.level
    : isCoachLevel(profile?.level)
      ? profile.level
      : DEFAULT_CONTEXT.level
  return { age, format: explicitFormat ?? AGE_PROFILES[age].format, level }
}

/** The most players per team this context permits. */
export function maxPlayersPerTeam(ctx: CoachContext): number {
  return FORMAT_PROFILES[ctx.format].perTeam
}

/**
 * Why a concept doesn't belong at this age — or null when it's fine.
 * Returned as a sentence because it goes straight into the coach's summary:
 * refusing without explaining is worse than not refusing at all.
 */
export function conceptObjection(ctx: CoachContext, conceptId: string | undefined): string | null {
  if (!conceptId) return null
  return AGE_PROFILES[ctx.age].disallowedConcepts[conceptId] ?? null
}

/** A short, human description used in prompts and summaries. */
export function describeContext(ctx: CoachContext): string {
  const age = AGE_PROFILES[ctx.age]
  return `${age.label} · ${FORMAT_PROFILES[ctx.format].label} · ${LEVEL_LABELS[ctx.level]}`
}
