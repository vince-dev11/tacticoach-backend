// Football DSL v0 — pattern library (6 core patterns).
//
// Patterns are SYMBOLIC: roles + actions only, zero coordinates. The compiler
// (ai.dsl.ts) adapts each one to any formation and either side. Every pattern
// must pass the full validator pipeline for all formations × sides — enforced
// by tests/ai-dsl.test.ts, same self-check discipline as the exemplars.

import type { Pattern } from './ai.dsl.js'

export const PATTERNS: Pattern[] = [
  {
    id: 'overlap_wing',
    description: 'Winger cuts inside, full-back overlaps, cross to the striker (wing play, crosses, wide overloads)',
    roles: ['W', 'FB', 'ST'],
    opponents: [
      { ref: 'fb', label: '3', near: 'W', dx: 90, dy: 40 },
      { ref: 'cb', label: '5', near: 'ST', dx: 70, dy: -30 },
      { ref: 'gk', label: '1', near: 'ST', dx: 470, dy: 0 },
    ],
    startsWith: 'W',
    frames: [
      { W: { action: 'DRIBBLE_INSIDE' }, FB: { action: 'OVERLAP', target: 'W' } },
      { W: { action: 'PASS', target: 'FB' }, ST: { action: 'RUN_TO', zone: 'near_post' } },
      { FB: { action: 'CROSS', zone: 'far_post' }, ST: { action: 'RUN_TO', zone: 'far_post' } },
      { ST: { action: 'FINISH' } },
    ],
  },
  {
    id: 'one_two',
    description: 'Give-and-go around a defender: pass, dart behind, take the return in stride (wall pass, combinations)',
    roles: ['AM', 'ST'],
    opponents: [
      { ref: 'cb', label: '4', near: 'AM', dx: 80, dy: 20 },
    ],
    startsWith: 'AM',
    frames: [
      { AM: { action: 'PASS', target: 'ST' } },
      { AM: { action: 'RUN', dx: 170, dy: -70 }, ST: { action: 'HOLD' } },
      { ST: { action: 'PASS', target: 'AM' } },
      { AM: { action: 'DRIBBLE', dx: 150, dy: 0 } },
    ],
  },
  {
    id: 'third_man',
    description: 'Third-man combination: pass into the striker, lay-off to the runner arriving from deep',
    roles: ['DM', 'ST', 'AM'],
    opponents: [
      { ref: 'dm', label: '6', near: 'AM', dx: 60, dy: 50 },
      { ref: 'cb', label: '5', near: 'ST', dx: 80, dy: 0 },
    ],
    startsWith: 'DM',
    frames: [
      { DM: { action: 'PASS', target: 'ST' }, AM: { action: 'RUN', dx: 180, dy: -80 } },
      { ST: { action: 'PASS', target: 'AM' } },
      { AM: { action: 'DRIBBLE', dx: 150, dy: 0 } },
    ],
  },
  {
    id: 'counter_attack',
    description: 'Fast counter after a regain: release the winger early, finish from the cutback (transitions, fast breaks)',
    roles: ['DM', 'W', 'ST'],
    opponents: [
      { ref: 'cm', label: '8', near: 'DM', dx: 110, dy: -40 },
      { ref: 'cb', label: '4', near: 'ST', dx: 130, dy: 20 },
    ],
    startsWith: 'DM',
    frames: [
      { DM: { action: 'DRIBBLE', dx: 130, dy: 0 }, W: { action: 'RUN', dx: 200, dy: -20 }, ST: { action: 'RUN', dx: 120, dy: 0 } },
      { DM: { action: 'PASS', target: 'W' }, ST: { action: 'RUN', dx: 130, dy: 0 } },
      { W: { action: 'DRIBBLE', dx: 200, dy: 0 }, ST: { action: 'RUN_TO', zone: 'cutback_spot' } },
      { W: { action: 'CUTBACK', target: 'ST' } },
      { ST: { action: 'FINISH' } },
    ],
  },
  {
    id: 'high_press_trap',
    description: 'High pressing trap: invite the pass wide, then swarm the touchline and win it (pressing, gegenpressing)',
    roles: ['ST', 'W', 'CM'],
    opponents: [
      { ref: 'gk', label: '1', near: 'ST', dx: 420, dy: 0 },
      { ref: 'cb', label: '4', near: 'ST', dx: 260, dy: -80 },
      { ref: 'fb', label: '2', near: 'W', dx: 220, dy: -20 },
    ],
    startsWith: 'opp:gk',
    frames: [
      { 'opp:gk': { action: 'PASS', target: 'opp:cb' }, ST: { action: 'PRESS', target: 'opp:cb' }, W: { action: 'RUN', dx: 90, dy: -30 } },
      { 'opp:cb': { action: 'PASS', target: 'opp:fb' }, W: { action: 'PRESS', target: 'opp:fb' }, CM: { action: 'COVER', target: 'W' } },
      { W: { action: 'WIN' }, ST: { action: 'RUN', dx: 60, dy: -40 } },
    ],
  },
  {
    id: 'build_up',
    description: 'Build-up from the goalkeeper: split pass, pivot receives on the half-turn, out to the advanced full-back (playing out, salida)',
    roles: ['GK', 'CB', 'DM', 'FB'],
    opponents: [
      { ref: 'st', label: '9', near: 'DM', dx: -70, dy: -40 },
      { ref: 'w', label: '7', near: 'CB', dx: 120, dy: -60 },
    ],
    startsWith: 'GK',
    frames: [
      { GK: { action: 'PASS', target: 'CB' }, DM: { action: 'RUN', dx: 30, dy: 60 }, FB: { action: 'RUN', dx: 110, dy: 0 } },
      { CB: { action: 'PASS', target: 'DM' }, FB: { action: 'RUN', dx: 120, dy: 0 } },
      { DM: { action: 'PASS', target: 'FB' } },
      { FB: { action: 'DRIBBLE', dx: 150, dy: 0 } },
    ],
  },
]

export const PATTERN_IDS = PATTERNS.map((p) => p.id)

export function patternById(id: string): Pattern | undefined {
  return PATTERNS.find((p) => p.id === id)
}

/** Catalogue text for the LLM plan picker. */
export function patternCatalogue(): string {
  return PATTERNS.map((p) => `- "${p.id}": ${p.description}`).join('\n')
}
