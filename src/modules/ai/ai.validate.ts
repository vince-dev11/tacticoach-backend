// Football-validity checks — the layer BETWEEN "the JSON parses" and "a coach
// would accept this". Every function returns a list of human-readable issues;
// an empty list means the output passed. Issues are fed back to Gemini for one
// corrective retry (see ai.routes), so most slips never reach the user.

import type { CleanItem, Brief } from './ai.schema.js'
import {
  areaRect, DEFAULT_BOARD, PRINCIPLE_LABELS,
  type AreaId, type Board, type PrincipleId,
} from './ai.concepts.js'
import {
  AGE_PROFILES, FORMAT_PROFILES, conceptObjection, maxPlayersPerTeam,
  type CoachContext,
} from './ai.context.js'

const GK_LABELS = new Set(['gk', 'g', 'por', 'tw', 'gard', 'kal'])

function isPlayer(o: CleanItem): boolean {
  return o.type === 'player'
}

function isGk(o: CleanItem): boolean {
  const label = String(o.props?.label ?? '').trim().toLowerCase()
  return isPlayer(o) && GK_LABELS.has(label)
}

/** Team bucket by object key (player_blue vs player_red etc.). */
function teamOf(o: CleanItem): string {
  return o.key.includes('red') ? 'red' : o.key.includes('blue') ? 'blue' : 'other'
}

/** "4-3-3" → 10, when the prompt names a formation. */
function formationOutfielders(prompt: string): number | null {
  const m = prompt.match(/\b([1-5])-([1-5])-([1-5])(?:-([1-5]))?\b/)
  if (!m) return null
  return m
    .slice(1)
    .filter(Boolean)
    .reduce((a, b) => a + Number(b), 0)
}

/**
 * Squad-size checks against the format the team actually plays.
 *
 * These are the strictest checks in the file, and deliberately so. Most of what
 * this module measures is a matter of degree — spacing could be tighter, width
 * could be better. This one is binary: an under-9 side plays 7v7, so an eleventh
 * blue shirt is not a weak animation, it is a picture of a match that cannot
 * happen. Anything a coach would call impossible belongs here rather than in the
 * quality score, because a score of 78 still ships.
 *
 * A drill is exempt — a rondo or a finishing pattern uses whoever it needs, and
 * nobody would object to 4v2 in a 7v7 age group.
 */
export function validateSquadSize(objects: CleanItem[], ctx: CoachContext): string[] {
  const issues: string[] = []
  const cap = maxPlayersPerTeam(ctx)
  const format = FORMAT_PROFILES[ctx.format].label
  for (const team of ['blue', 'red'] as const) {
    const count = objects.filter((o) => isPlayer(o) && teamOf(o) === team).length
    // Only a full-sided picture can be over the limit; small-sided work is fine.
    if (count > cap) {
      issues.push(
        `team ${team} has ${count} players but this is a ${format} session — at most ${cap} per team, including the goalkeeper`,
      )
    }
  }
  return issues
}

/** The concept the coach asked for is wrong for the age — say so, with a reason. */
export function validateAgeAppropriate(conceptId: string | undefined, ctx: CoachContext): string[] {
  const objection = conceptObjection(ctx, conceptId)
  return objection
    ? [`"${conceptId}" is not appropriate for ${AGE_PROFILES[ctx.age].label}: ${objection}`]
    : []
}

/**
 * Validate a generated static layout.
 * Checks are deliberately lenient — drills, rondos and set pieces are all
 * legitimate boards. Only clear football nonsense is flagged.
 */
export function validateLayout(objects: CleanItem[], prompt: string): string[] {
  const issues: string[] = []
  const players = objects.filter(isPlayer)

  // Two goalkeepers on one team is always wrong.
  for (const team of ['blue', 'red']) {
    const gks = players.filter((p) => teamOf(p) === team && isGk(p))
    if (gks.length > 1) issues.push(`team ${team} has ${gks.length} goalkeepers — a team has at most one`)
  }

  // Players stacked on top of each other are unusable on a board.
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const dx = players[i].x - players[j].x
      const dy = players[i].y - players[j].y
      if (Math.hypot(dx, dy) < 22) {
        issues.push(
          `players "${players[i].ref}" and "${players[j].ref}" overlap at (${players[i].x},${players[i].y}) — spread players out`,
        )
      }
    }
  }

  // "N v M" small-sided games must have N+M players (± explicit neutrals/GKs).
  const svm = prompt.match(/\b(\d{1,2})\s*(?:v|vs\.?)\s*(\d{1,2})\b/i)
  if (svm) {
    const expected = Number(svm[1]) + Number(svm[2])
    if (expected >= 2 && expected <= 22 && (players.length < expected || players.length > expected + 3)) {
      issues.push(
        `the prompt describes a ${svm[1]}v${svm[2]} — that needs ${expected} players (plus explicit neutrals only), you placed ${players.length}`,
      )
    }
  }

  // A named formation must have the right number of outfielders on the main team.
  const expectedOutfield = formationOutfielders(prompt)
  if (expectedOutfield !== null) {
    const byTeam = new Map<string, CleanItem[]>()
    for (const p of players) {
      const t = teamOf(p)
      byTeam.set(t, [...(byTeam.get(t) ?? []), p])
    }
    const main = [...byTeam.values()].sort((a, b) => b.length - a.length)[0] ?? []
    // Only enforce when the model clearly attempted a full team.
    if (main.length >= 8) {
      const outfield = main.filter((p) => !isGk(p)).length
      if (outfield !== expectedOutfielders(expectedOutfield, main.length)) {
        issues.push(
          `the prompt asks for a ${prompt.match(/\b[1-5](?:-[1-5]){2,3}\b/)?.[0]} — that needs ${expectedOutfield} outfield players, the main team has ${outfield}`,
        )
      }
    }
  }

  return issues
}

// A named formation implies GK + outfielders; if the model placed no GK we
// still expect the outfield count to match the formation sum.
function expectedOutfielders(fromFormation: number, _teamSize: number): number {
  return fromFormation
}

// Prompt words (several languages) that imply the ball circulates. When any
// match and the ball never moves, the animation is telling the wrong story.
const BALL_ACTION =
  /pass|switch|cross|counter|build|combi|rondo|shot|finish|circulat|pase|pased|centro|contra|salida|tiro|passe|centre|contre|relance|flanke|konter|aufbau|schuss|spielaufbau|cruzamento|contra-ataque/i

/** "3 phases" / "tres fases" / "drei Phasen" → 3, when the prompt counts them. */
function promptPhases(prompt: string): number | null {
  const m = prompt.match(/\b(\d)\s*(?:phases?|steps?|stages?|fases?|phasen|etapas?|étapes?|fazy?|aşama\w*)\b/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 2 && n <= 6 ? n : null
}

/** Validate animation frames on top of the layout checks. */
export function validateAnimation(
  objects: CleanItem[],
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
  prompt: string,
): string[] {
  const issues = validateLayout(objects, prompt)
  const pos = new Map(objects.map((o) => [o.ref, { x: o.x, y: o.y }]))
  const players = objects.filter(isPlayer)
  const ball = objects.find((o) => o.type === 'football')

  const totalMoves = frames.reduce((n, f) => n + f.moves.length, 0)
  if (totalMoves === 0) issues.push('the animation contains no movement — add frames with moves')

  const movedRefs = new Set<string>()
  frames.forEach((frame, fi) => {
    let frameNet = 0
    for (const move of frame.moves) {
      const from = pos.get(move.ref)
      if (!from) continue
      const dist = Math.hypot(move.to.x - from.x, move.to.y - from.y)
      frameNet += dist
      if (dist >= 10) movedRefs.add(move.ref)
      // One frame ≈ 3 seconds. > 900px (~2/3 pitch length) reads as teleporting.
      if (dist > 900) {
        issues.push(
          `"${move.ref}" moves ${Math.round(dist)}px in frame ${fi + 1} — no player covers that in one phase, break it into steps`,
        )
      }
      pos.set(move.ref, move.to)
    }
    // A frame whose moves all go (nearly) nowhere is padding, not a phase.
    if (frame.moves.length > 0 && frameNet < 15) {
      issues.push(`frame ${fi + 1} contains no real movement — every phase must advance the action`)
    }

    // One ball owner (PRD rule): at the end of each phase the ball belongs to
    // SOMEONE — a ball drifting to empty grass is not football.
    if (ball && players.length > 0) {
      const bp = pos.get(ball.ref)
      if (bp) {
        const nearest = Math.min(...players.map((p) => {
          const pp = pos.get(p.ref) ?? { x: p.x, y: p.y }
          return Math.hypot(bp.x - pp.x, bp.y - pp.y)
        }))
        // A ball inside either goalmouth is a finish — no owner needed.
        const inGoalmouth = (bp.x <= 110 || bp.x >= 1290) && bp.y >= 260 && bp.y <= 460
        if (nearest > 90 && !inGoalmouth) {
          issues.push(
            `the ball ends frame ${fi + 1} ${Math.round(nearest)}px from the nearest player — the ball must end each phase with a player (or in the goal)`,
          )
        }
      }
    }
  })

  // The story needs the ball: passing/counter/build-up prompts where the ball
  // never travels miss the point of the animation.
  if (ball && totalMoves > 0 && !movedRefs.has(ball.ref) && BALL_ACTION.test(prompt)) {
    issues.push(
      'the ball never moves, but the request describes ball circulation — add explicit ball moves to each receiving player',
    )
  }

  // "3 phases" answered with fewer frames tells a shorter story than asked for.
  const phases = promptPhases(prompt)
  if (phases !== null && frames.length < phases) {
    issues.push(`the request names ${phases} phases but you produced ${frames.length} frames — one frame per phase`)
  }

  // A team action where almost nobody moves reads as statues, not football.
  if (players.length >= 8 && totalMoves > 0) {
    const movedPlayers = players.filter((p) => movedRefs.has(p.ref)).length
    if (movedPlayers <= 1) {
      issues.push(
        `only ${movedPlayers} of ${players.length} players ever move — supporting players and defenders must adjust with the action`,
      )
    }
  }

  return issues
}

/**
 * SELF-CONSISTENCY: check the drawing against the model's OWN stated plan.
 *
 * The brief is written before any coordinate exists, so these checks catch a
 * different class of error than the football validators: the model said one
 * thing and drew another. Corrective retries quoting a self-contradiction
 * ("your brief says 6 players, you placed 14") are far easier for a model to
 * fix than geometry complaints.
 */
export function validateBrief(
  brief: Brief | undefined,
  objects: CleanItem[],
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
  board: Board = DEFAULT_BOARD,
): string[] {
  if (!brief) return []
  const issues: string[] = []
  const players = objects.filter((o) => o.type === 'player')
  const promised = (brief.attackers ?? 0) + (brief.defenders ?? 0)

  // 1. Player count matches the plan (±1 tolerance for an implied goalkeeper).
  if (promised > 0 && Math.abs(players.length - promised) > 1) {
    issues.push(
      `your brief promised ${brief.attackers} attackers + ${brief.defenders} defenders (${promised} players) but you placed ${players.length}`,
    )
  }

  // 2. One frame per declared phase.
  if (frames.length > 0 && brief.phases.length >= 2 && frames.length < brief.phases.length) {
    issues.push(
      `your brief lists ${brief.phases.length} phases (${brief.phases.slice(0, 3).join('; ')}) but you produced only ${frames.length} frames — one frame per phase`,
    )
  }

  // 3. Every named role exists and actually moves.
  const refs = new Set(objects.map((o) => o.ref))
  const moved = new Set(frames.flatMap((f) => f.moves.map((m) => m.ref)))
  for (const role of brief.roles) {
    if (!refs.has(role.ref)) {
      issues.push(`your brief gives "${role.ref}" the job "${role.job}" but no object with that ref exists`)
    } else if (frames.length > 0 && !moved.has(role.ref)) {
      issues.push(`"${role.ref}" is given the job "${role.job}" in your brief but never moves in any frame`)
    }
  }

  // 4. Objects sit inside the declared playing area (a rondo must not sprawl
  //    across the pitch). Generous tolerance — the area is a guide, not a cage.
  const area = brief.area as AreaId
  const rect = areaRect(area, board)
  if (area && area !== 'full_pitch') {
    const tolX = rect.w * 0.25 + 40
    const tolY = rect.h * 0.25 + 40
    const outside = objects.filter(
      (o) =>
        o.x < rect.x - tolX || o.x > rect.x + rect.w + tolX ||
        o.y < rect.y - tolY || o.y > rect.y + rect.h + tolY,
    )
    if (outside.length > Math.max(1, Math.floor(objects.length * 0.2))) {
      issues.push(
        `your brief chose the area "${area}" (x ${rect.x}–${rect.x + rect.w}, y ${rect.y}–${rect.y + rect.h}) but ${outside.length} objects are placed far outside it`,
      )
    }
  }

  return issues
}

// ---- Football principles ----------------------------------------------------
//
// Validators above answer "is this WRONG?". These answer "is this GOOD?" — the
// difference between an animation that survives review and one a coach would
// actually show a team. Each principle is a geometric measurement over the
// frame sequence, so tactical quality becomes arithmetic instead of opinion.

interface Snapshot {
  /** Positions of every object at the end of frame i (index 0 = kick-off scene). */
  pos: Map<string, { x: number; y: number }>
}

/** Replay the frames, capturing the board state after each one. */
function timeline(
  objects: CleanItem[],
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
): Snapshot[] {
  const pos = new Map(objects.map((o) => [o.ref, { x: o.x, y: o.y }]))
  const out: Snapshot[] = [{ pos: new Map([...pos].map(([k, v]) => [k, { ...v }])) }]
  for (const f of frames) {
    for (const m of f.moves) pos.set(m.ref, { ...m.to })
    out.push({ pos: new Map([...pos].map(([k, v]) => [k, { ...v }])) })
  }
  return out
}

const spread = (pts: { x: number; y: number }[], axis: 'x' | 'y') =>
  pts.length < 2 ? 0 : Math.max(...pts.map((p) => p[axis])) - Math.min(...pts.map((p) => p[axis]))

export interface PrincipleResult {
  id: PrincipleId
  present: boolean
  detail: string
}

/**
 * Measure each requested principle against the animation.
 * `attackDir` is +1 when the attacking team moves left→right (the default for
 * blue), -1 otherwise; it is inferred from net ball travel.
 */
export function validatePrinciples(
  principles: PrincipleId[],
  objects: CleanItem[],
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
  board: Board = DEFAULT_BOARD,
): PrincipleResult[] {
  const tl = timeline(objects, frames)
  const first = tl[0]
  const last = tl[tl.length - 1]
  const players = objects.filter(isPlayer)
  const home = players.filter((p) => teamOf(p) !== 'red')
  const away = players.filter((p) => teamOf(p) === 'red')
  const ball = objects.find((o) => o.type === 'football')
  const at = (snap: Snapshot, refs: CleanItem[]) => refs.map((r) => snap.pos.get(r.ref)!).filter(Boolean)
  const ballAt = (snap: Snapshot) => (ball ? snap.pos.get(ball.ref) : undefined)

  // Attacking direction comes from the TEAM CONVENTION, not from ball travel:
  // blue attacks left→right, red attacks right→left (stated in every prompt).
  // Inferring from the ball would make a backwards pass look "forward" simply
  // because it was the only movement. Whoever starts with the ball defines it.
  const b0 = ballAt(first)
  const b1 = ballAt(last)
  let dir = 1
  if (b0 && players.length > 0) {
    const nearest = players.reduce((best, p) => {
      const bp = first.pos.get(p.ref) ?? { x: p.x, y: p.y }
      const cp = first.pos.get(best.ref) ?? { x: best.x, y: best.y }
      return Math.hypot(bp.x - b0.x, bp.y - b0.y) < Math.hypot(cp.x - b0.x, cp.y - b0.y) ? p : best
    })
    dir = teamOf(nearest) === 'red' ? -1 : 1
  }

  const check = (id: PrincipleId): PrincipleResult => {
    const yes = (detail: string) => ({ id, present: true, detail })
    const no = (detail: string) => ({ id, present: false, detail })

    switch (id) {
      case 'forward_play': {
        if (!b0 || tl.length < 2) return no('no ball movement to judge')
        const afterFirst = ballAt(tl[1])!
        const gained = (afterFirst.x - b0.x) * dir
        return gained > board.width * 0.03
          ? yes(`first action gains ${Math.round(gained)} units forward`)
          : no(`the first ball action goes ${Math.round(gained)} units forward — it must attack immediately`)
      }
      case 'width': {
        const start = spread(at(first, home), 'y')
        const end = spread(at(last, home), 'y')
        return end >= start * 0.95 && end > board.height * 0.35
          ? yes(`lateral spread ${Math.round(start)} → ${Math.round(end)}`)
          : no(`the attack narrows (spread ${Math.round(start)} → ${Math.round(end)}) — stretch the defence`)
      }
      case 'depth': {
        if (away.length === 0) return no('no opponents, so nobody can be run beyond')
        const deepest = Math.max(...at(last, away).map((p) => p.x * dir))
        const runner = Math.max(...at(last, home).map((p) => p.x * dir))
        return runner > deepest
          ? yes('an attacker finishes beyond the deepest defender')
          : no('nobody runs beyond the last defender — the animation has no depth')
      }
      case 'support': {
        const bp = ballAt(last)
        if (!bp) return no('no ball to support')
        const near = at(last, home).filter((p) => Math.hypot(p.x - bp.x, p.y - bp.y) < board.width * 0.22)
        return near.length >= 2
          ? yes(`${near.length} players within support distance of the ball`)
          : no('the ball carrier is isolated — give him a nearby option')
      }
      case 'speed':
        return frames.length <= 5
          ? yes(`${frames.length} phases — resolves quickly`)
          : no(`${frames.length} phases is slow for this concept`)
      case 'penetration': {
        if (!b0 || !b1) return no('no ball movement to judge')
        const gained = (b1.x - b0.x) * dir
        return gained > board.width * 0.15
          ? yes(`the ball advances ${Math.round(gained)} units`)
          : no(`the ball only advances ${Math.round(gained)} units — no real progress`)
      }
      case 'compactness': {
        const unit = home.length >= away.length ? home : away
        const pts = at(last, unit)
        const w = spread(pts, 'y')
        const d = spread(pts, 'x')
        return unit.length >= 4 && w < board.height * 0.85 && d < board.width * 0.45
          ? yes(`unit stays compact (${Math.round(d)}×${Math.round(w)})`)
          : no(`the defending unit is stretched (${Math.round(d)}×${Math.round(w)}) — hold the distances`)
      }
      case 'pressing_trigger': {
        if (tl.length < 3) return no('too few phases to show a trigger')
        const bp1 = ballAt(tl[1])
        const bp2 = ballAt(tl[2])
        if (!bp1 || !bp2) return no('no ball to press')
        const dist = (snap: Snapshot, bp: { x: number; y: number }) =>
          Math.min(...at(snap, home).map((p) => Math.hypot(p.x - bp.x, p.y - bp.y)))
        return dist(tl[2], bp2) < dist(tl[1], bp1)
          ? yes('pressure closes as the ball travels')
          : no('nobody closes the ball down as it moves — the trigger is missing')
      }
      case 'cover': {
        const bp = ballAt(last)
        if (!bp || home.length < 2) return no('not enough players to cover')
        const sorted = at(last, home).sort(
          (a, b2) => Math.hypot(a.x - bp.x, a.y - bp.y) - Math.hypot(b2.x - bp.x, b2.y - bp.y),
        )
        const gap = Math.hypot(sorted[0].x - sorted[1].x, sorted[0].y - sorted[1].y)
        return gap < board.width * 0.25
          ? yes('the presser has a covering teammate behind him')
          : no('the nearest presser has no cover — a beaten presser leaves a hole')
      }
      case 'overload': {
        const bp = ballAt(last)
        if (!bp || away.length === 0) return no('no opponents to outnumber')
        const r = board.width * 0.25
        const ours = at(last, home).filter((p) => Math.hypot(p.x - bp.x, p.y - bp.y) < r).length
        const theirs = at(last, away).filter((p) => Math.hypot(p.x - bp.x, p.y - bp.y) < r).length
        return ours > theirs
          ? yes(`${ours}v${theirs} around the ball`)
          : no(`no numerical advantage around the ball (${ours}v${theirs})`)
      }
      case 'possession_security': {
        const bp = ballAt(last)
        if (!bp) return no('no ball')
        const near = at(last, home).filter((p) => Math.hypot(p.x - bp.x, p.y - bp.y) < board.width * 0.25)
        const bothSides = near.some((p) => p.y < bp.y - 20) && near.some((p) => p.y > bp.y + 20)
        return near.length >= 2 && bothSides
          ? yes('options on both sides of the carrier')
          : no('the carrier has no options either side — possession is fragile')
      }
      default:
        return no('unknown principle')
    }
  }

  return principles.map(check)
}

/**
 * Tactical quality score 0–100: how many of the requested principles are
 * actually visible. LOGGED, never blocking — a low score tells us to improve
 * the pattern/prompt, it does not deny the coach an animation.
 */
export function tacticalScore(results: PrincipleResult[]): number {
  if (results.length === 0) return 100
  return Math.round((results.filter((r) => r.present).length / results.length) * 100)
}

/** Missing principles as corrective-retry feedback lines. */
export function principleIssues(results: PrincipleResult[]): string[] {
  return results
    .filter((r) => !r.present)
    .map((r) => `${PRINCIPLE_LABELS[r.id]} — ${r.detail}`)
}

/** Validate reel copy — text quality, not football geometry. */
export function validateReelCopy(copy: {
  title: string
  subtitle: string
  quote: string
  quoteDetail: string
  stats: { value: string; label: string }[]
  tags: string[]
  hashtags: string
}): string[] {
  const issues: string[] = []
  const junk = /\*\*|```|\{|\}|<[a-z]/i

  if (junk.test(copy.title + copy.quote + copy.subtitle)) {
    issues.push('copy contains markdown or markup artifacts — plain text only')
  }
  if (copy.title.trim().length < 6 || /^(title|reel|untitled)$/i.test(copy.title.trim())) {
    issues.push('title is a placeholder — write a real hook title about the tactic')
  }
  if (copy.quote.trim().toLowerCase() === copy.title.trim().toLowerCase()) {
    issues.push('quote merely repeats the title — the quote must add the key coaching insight')
  }
  for (const s of copy.stats) {
    if (!/^[\d.,:%xvs+\-–]{1,8}$/i.test(s.value.trim())) {
      issues.push(`stat value "${s.value}" is not a short figure — use forms like 87%, 6s, 3v2`)
    }
  }
  if (!copy.hashtags.trim().startsWith('#')) {
    issues.push('hashtags line must start with # (e.g. "#football #coaching")')
  }
  return issues
}
