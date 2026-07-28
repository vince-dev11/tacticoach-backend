// Football DSL v0 — deterministic compiler.
//
// The LLM's job shrinks to choosing a PATTERN + parameters (side, formation);
// this compiler owns ALL geometry. Because coordinates are derived from action
// semantics, the failure modes our validators exist to catch (teleports,
// abandoned balls, statue teams, overlapping tokens) are impossible by
// construction. Output is the editor's existing objects+frames contract — the
// frontend is untouched.
//
// Board: 1400×720, home (blue) attacks left → right. Side convention:
// 'right' = the top lane (y small) where RW/RB live; 'left' mirrors to the
// bottom lane via role resolution + a lateral sign — never by coordinate flip.

import type { CleanItem } from './ai.schema.js'

export type Side = 'right' | 'left'
export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2'

// ---- Roles & formations -----------------------------------------------------

type Role = string // canonical tokens: GK RB RCB CB LCB LB RWB LWB DM RCM LCM AM RM LM RW LW ST SS

/** Anchor positions per formation (blue, mid-block, attacking right). */
const FORMATIONS: Record<FormationId, Record<Role, [number, number]>> = {
  '4-3-3': {
    GK: [90, 360], RB: [280, 130], RCB: [250, 280], LCB: [250, 440], LB: [280, 590],
    DM: [420, 360], RCM: [540, 250], LCM: [540, 470],
    RW: [780, 130], LW: [780, 590], ST: [800, 360],
  },
  '4-4-2': {
    GK: [90, 360], RB: [280, 130], RCB: [250, 280], LCB: [250, 440], LB: [280, 590],
    RM: [560, 150], RCM: [480, 300], LCM: [480, 420], LM: [560, 570],
    ST: [790, 300], SS: [720, 430],
  },
  '4-2-3-1': {
    GK: [90, 360], RB: [280, 130], RCB: [250, 280], LCB: [250, 440], LB: [280, 590],
    RDM: [420, 290], LDM: [420, 430], AM: [640, 360],
    RW: [760, 140], LW: [760, 580], ST: [810, 360],
  },
  '3-5-2': {
    GK: [90, 360], RCB: [250, 230], CB: [230, 360], LCB: [250, 490],
    RWB: [400, 110], LWB: [400, 610], DM: [430, 360], RCM: [560, 270], LCM: [560, 450],
    ST: [800, 300], SS: [740, 420],
  },
}

/** Shirt labels per role. */
const LABELS: Record<Role, string> = {
  GK: '1', RB: '2', LB: '3', RCB: '4', CB: '4', LCB: '5', RWB: '2', LWB: '3',
  DM: '6', RDM: '6', LDM: '8', RCM: '8', LCM: '10', AM: '10', RM: '7', LM: '11',
  RW: '7', LW: '11', ST: '9', SS: '10',
}

/** Generic tokens resolve per formation + side; missing roles substitute the
 *  nearest equivalent, never reusing a role already cast in this pattern —
 *  the compiler never fails on a formation mismatch. */
function resolveRole(token: Role, formation: FormationId, side: Side, used: Set<Role>): Role {
  const free = (r: Role) => r in FORMATIONS[formation] && !used.has(r)
  const pick = (...cands: Role[]) =>
    cands.find(free) ?? Object.keys(FORMATIONS[formation]).find((r) => !used.has(r)) ?? cands[0]
  switch (token) {
    case 'W': return side === 'right' ? pick('RW', 'RM', 'RWB', 'RCM') : pick('LW', 'LM', 'LWB', 'LCM')
    case 'FB': return side === 'right' ? pick('RB', 'RWB', 'RCB', 'RCM') : pick('LB', 'LWB', 'LCB', 'LCM')
    case 'CM': return pick('RCM', 'CM', 'AM', 'LCM')
    case 'AM': return pick('AM', 'SS', 'LCM', 'RCM')
    case 'DM': return pick('DM', 'RDM', 'RCM', 'CM')
    case 'CB': return side === 'right' ? pick('RCB', 'CB', 'LCB') : pick('LCB', 'CB', 'RCB')
    default: return pick(token, 'RCM', 'DM', 'ST')
  }
}

// ---- Zones ------------------------------------------------------------------

/** Landmarks authored for side 'right' (top lane); 'left' mirrors y. */
function zone(name: string, side: Side): [number, number] {
  const Z: Record<string, [number, number]> = {
    near_post: [1265, 310], far_post: [1265, 415], cutback_spot: [1195, 375],
    byline: [1300, 105], wing: [980, 115], halfspace: [900, 240],
    edge_of_box: [1115, 330], goal: [1345, 360], centre: [700, 360],
  }
  const [x, y] = Z[name] ?? Z.centre
  return side === 'right' ? [x, y] : [x, 720 - y]
}

// ---- Pattern schema ---------------------------------------------------------

export interface StepAction {
  action:
    | 'PASS' | 'DRIBBLE' | 'DRIBBLE_INSIDE' | 'RUN' | 'RUN_TO' | 'OVERLAP'
    | 'CROSS' | 'CUTBACK' | 'SHOOT' | 'FINISH' | 'PRESS' | 'COVER' | 'WIN' | 'HOLD'
  target?: string        // PASS/CUTBACK/PRESS/COVER/OVERLAP reference (role token or opponent ref)
  zone?: string          // RUN_TO / CROSS destination
  dx?: number            // RUN / DRIBBLE relative movement (authored for side 'right')
  dy?: number            // positive dy = toward the acting flank's far side
}

export interface Opponent {
  ref: string
  label: string
  /** Anchor relative to a (resolved) role's start position. */
  near: string
  dx: number
  dy: number
}

export interface Pattern {
  id: string
  /** One-line catalogue description shown to the LLM plan picker. */
  description: string
  roles: string[]
  opponents: Opponent[]
  /** Who starts with the ball ('opp:<ref>' for an opponent). */
  startsWith: string
  /** frames[i] maps actor (role token or 'opp:<ref>') → action. */
  frames: Record<string, StepAction>[]
}

// ---- Compiler ---------------------------------------------------------------

const clampX = (v: number) => Math.min(Math.max(Math.round(v), 40), 1360)
const clampY = (v: number) => Math.min(Math.max(Math.round(v), 40), 680)

export interface Compiled {
  objects: CleanItem[]
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[]
}

/**
 * Compile a pattern into board objects + movement frames.
 * Deterministic: same inputs always produce the same animation.
 */
export function compilePattern(pattern: Pattern, formation: FormationId, side: Side): Compiled {
  // Lateral sign: on the 'right' (top) side, "toward the touchline" means -y.
  const lat = side === 'right' ? 1 : -1

  // ---- Cast: resolve roles → refs + start positions
  const refOf = new Map<string, string>() // actor token → object ref
  const pos = new Map<string, { x: number; y: number }>()
  const objects: CleanItem[] = []

  const usedRoles = new Set<Role>()
  for (const token of pattern.roles) {
    const role = resolveRole(token, formation, side, usedRoles)
    usedRoles.add(role)
    const [x, y] = FORMATIONS[formation][role]
    const ref = `h_${role.toLowerCase()}`
    refOf.set(token, ref)
    pos.set(ref, { x, y })
    objects.push({ ref, key: 'player_blue', type: 'player', x, y, props: { label: LABELS[role] ?? '8' } })
  }
  for (const opp of pattern.opponents) {
    const anchorRef = refOf.get(opp.near)
    const base = anchorRef ? pos.get(anchorRef)! : { x: 700, y: 360 }
    const x = clampX(base.x + opp.dx)
    const y = clampY(base.y + opp.dy * lat)
    const ref = `a_${opp.ref}`
    refOf.set(`opp:${opp.ref}`, ref)
    pos.set(ref, { x, y })
    objects.push({ ref, key: 'player_red', type: 'player', x, y, props: { label: opp.label } })
  }

  // Ball starts at its owner's feet.
  const ownerRef = (token: string) => refOf.get(token) ?? [...refOf.values()][0]
  let ballOwner = ownerRef(pattern.startsWith)
  const ballStart = pos.get(ballOwner)!
  const ballRef = 'ball'
  pos.set(ballRef, { x: clampX(ballStart.x + 12), y: clampY(ballStart.y + 8) })
  objects.push({ ref: ballRef, key: 'white_ball', type: 'football', x: pos.get(ballRef)!.x, y: pos.get(ballRef)!.y })

  // ---- Frames
  const frames: Compiled['frames'] = []

  for (const step of pattern.frames) {
    const before = new Map([...pos.entries()].map(([k, v]) => [k, { ...v }]))
    let ballTo: { x: number; y: number } | null = null
    let nextOwner = ballOwner

    // 1. Resolve every actor's movement (and at most one ball action).
    for (const [actor, act] of Object.entries(step)) {
      const ref = refOf.get(actor)
      if (!ref) throw new Error(`pattern ${pattern.id}: unknown actor "${actor}"`)
      const p = pos.get(ref)!
      const move = (x: number, y: number) => pos.set(ref, { x: clampX(x), y: clampY(y) })
      const targetRef = act.target ? refOf.get(act.target) : undefined

      switch (act.action) {
        case 'HOLD':
          move(p.x + 14, p.y + 8 * lat)
          break
        case 'RUN':
          move(p.x + (act.dx ?? 120), p.y + (act.dy ?? 0) * lat)
          break
        case 'RUN_TO': {
          const [zx, zy] = zone(act.zone ?? 'centre', side)
          move(zx, zy)
          break
        }
        case 'OVERLAP': {
          const around = targetRef ? before.get(targetRef)! : p
          move(Math.max(p.x, around.x) + 190, around.y - 95 * lat)
          break
        }
        case 'DRIBBLE': {
          move(p.x + (act.dx ?? 160), p.y + (act.dy ?? 0) * lat)
          if (ballOwner === ref) ballTo = { x: pos.get(ref)!.x + 12, y: pos.get(ref)!.y + 8 }
          break
        }
        case 'DRIBBLE_INSIDE': {
          move(p.x + 140, p.y + 110 * lat)
          if (ballOwner === ref) ballTo = { x: pos.get(ref)!.x + 12, y: pos.get(ref)!.y + 8 }
          break
        }
        case 'PASS': {
          if (!targetRef) throw new Error(`pattern ${pattern.id}: PASS without receiver`)
          nextOwner = targetRef
          break // ball destination resolved after all movers (receiver may be mid-run)
        }
        case 'CROSS': {
          const [zx, zy] = zone(act.zone ?? 'far_post', side)
          ballTo = { x: zx, y: zy }
          nextOwner = '' // whoever arrives — resolved below
          break
        }
        case 'CUTBACK': {
          if (!targetRef) throw new Error(`pattern ${pattern.id}: CUTBACK without receiver`)
          nextOwner = targetRef
          break
        }
        case 'SHOOT':
        case 'FINISH': {
          const [gx, gy] = zone('goal', side)
          ballTo = { x: gx, y: gy + (side === 'right' ? -18 : 18) }
          nextOwner = ''
          move(p.x + 55, p.y - 20 * lat)
          break
        }
        case 'PRESS': {
          const prey = targetRef ? before.get(targetRef)! : pos.get(ballRef)!
          move(prey.x - 52, prey.y - 34 * lat)
          break
        }
        case 'COVER': {
          const mate = targetRef ? pos.get(targetRef)! : p
          move(mate.x - 105, mate.y + 60 * lat)
          break
        }
        case 'WIN': {
          const bp = pos.get(ballRef)!
          move(bp.x - 14, bp.y + 10)
          nextOwner = ref
          ballTo = { x: bp.x + 6, y: bp.y + 6 }
          break
        }
      }
    }

    // 2. Ball follows the (single) ball action; passes land at the receiver's
    //    END-of-frame position — receivers are hit in stride, never chased.
    if (nextOwner !== ballOwner && nextOwner !== '') {
      const rp = pos.get(nextOwner)!
      ballTo = { x: rp.x + 12, y: rp.y + 8 }
    }
    if (ballTo) pos.set(ballRef, { x: clampX(ballTo.x), y: clampY(ballTo.y) })
    // Crosses/shots: possession goes to whoever is nearest where it lands.
    if (nextOwner === '') {
      const bp = pos.get(ballRef)!
      let bestRef = ballOwner
      let best = Infinity
      for (const o of objects) {
        if (o.type !== 'player') continue
        const pp = pos.get(o.ref)!
        const d = Math.hypot(bp.x - pp.x, bp.y - pp.y)
        if (d < best) { best = d; bestRef = o.ref }
      }
      nextOwner = bestRef
    }
    ballOwner = nextOwner

    // 3. Everyone not acting drifts WITH the play (no statues, deterministic).
    const ballEnd = pos.get(ballRef)!
    for (const o of objects) {
      if (o.type !== 'player') continue
      const acted = Object.keys(step).some((a) => refOf.get(a) === o.ref)
      if (acted) continue
      const p = pos.get(o.ref)!
      const d = Math.hypot(ballEnd.x - p.x, ballEnd.y - p.y)
      const pull = d > 260 ? 34 : 16
      pos.set(o.ref, {
        x: clampX(p.x + ((ballEnd.x - p.x) / (d || 1)) * pull),
        y: clampY(p.y + ((ballEnd.y - p.y) / (d || 1)) * pull),
      })
    }

    // 4. Collision resolution: nudge any two players closer than 30 apart.
    const players = objects.filter((o) => o.type === 'player')
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = pos.get(players[i].ref)!
        const b = pos.get(players[j].ref)!
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < 30) {
          const push = (30 - d) / 2 + 4
          const nx = (b.x - a.x) / (d || 1)
          const ny = (b.y - a.y) / (d || 1)
          pos.set(players[i].ref, { x: clampX(a.x - nx * push), y: clampY(a.y - ny * push) })
          pos.set(players[j].ref, { x: clampX(b.x + nx * push), y: clampY(b.y + ny * push) })
        }
      }
    }

    // 5. Emit moves for everything that actually moved.
    const moves: { ref: string; to: { x: number; y: number } }[] = []
    for (const [ref, p] of pos.entries()) {
      const b = before.get(ref)!
      if (Math.hypot(p.x - b.x, p.y - b.y) >= 6) moves.push({ ref, to: { x: p.x, y: p.y } })
    }
    frames.push({ moves })
  }

  return { objects, frames }
}
