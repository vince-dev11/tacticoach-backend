// Football-validity checks — the layer BETWEEN "the JSON parses" and "a coach
// would accept this". Every function returns a list of human-readable issues;
// an empty list means the output passed. Issues are fed back to Gemini for one
// corrective retry (see ai.routes), so most slips never reach the user.

import type { CleanItem } from './ai.schema.js'

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

/** Validate animation frames on top of the layout checks. */
export function validateAnimation(
  objects: CleanItem[],
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
  prompt: string,
): string[] {
  const issues = validateLayout(objects, prompt)
  const pos = new Map(objects.map((o) => [o.ref, { x: o.x, y: o.y }]))

  const totalMoves = frames.reduce((n, f) => n + f.moves.length, 0)
  if (totalMoves === 0) issues.push('the animation contains no movement — add frames with moves')

  frames.forEach((frame, fi) => {
    for (const move of frame.moves) {
      const from = pos.get(move.ref)
      if (!from) continue
      const dist = Math.hypot(move.to.x - from.x, move.to.y - from.y)
      // One frame ≈ 3 seconds. > 900px (~2/3 pitch length) reads as teleporting.
      if (dist > 900) {
        issues.push(
          `"${move.ref}" moves ${Math.round(dist)}px in frame ${fi + 1} — no player covers that in one phase, break it into steps`,
        )
      }
      pos.set(move.ref, move.to)
    }
  })

  return issues
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
