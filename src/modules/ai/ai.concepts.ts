// Football concept knowledge cards + playing-area model.
//
// Two jobs:
//  1. CONCEPT CARDS — before drawing anything, the model is told how the
//     requested concept actually works: which phase of play, how many players,
//     where on the pitch, and the classic mistakes. The model fills in a brief
//     rather than inventing football from memory.
//  2. AREAS — every concept declares the part of the pitch it belongs on.
//     Areas are stored as FRACTIONS of the board, so they resolve correctly
//     whatever board size the caller passes (full pitch, portrait, custom).

export interface Board {
  width: number
  height: number
}

export const DEFAULT_BOARD: Board = { width: 1400, height: 720 }

export type AreaId =
  | 'full_pitch' | 'attacking_half' | 'defensive_half' | 'attacking_third'
  | 'middle_third' | 'final_third_wide' | 'penalty_box' | 'grid_small' | 'grid_medium'

export interface Rect { x: number; y: number; w: number; h: number }

/** Area → fraction of the board (x, y, w, h in 0..1). */
const AREA_FRACTIONS: Record<AreaId, Rect> = {
  full_pitch: { x: 0.02, y: 0.04, w: 0.96, h: 0.92 },
  attacking_half: { x: 0.46, y: 0.04, w: 0.52, h: 0.92 },
  defensive_half: { x: 0.02, y: 0.04, w: 0.52, h: 0.92 },
  attacking_third: { x: 0.62, y: 0.06, w: 0.36, h: 0.88 },
  middle_third: { x: 0.33, y: 0.06, w: 0.34, h: 0.88 },
  final_third_wide: { x: 0.60, y: 0.04, w: 0.38, h: 0.52 },
  penalty_box: { x: 0.78, y: 0.20, w: 0.20, h: 0.60 },
  grid_small: { x: 0.30, y: 0.24, w: 0.30, h: 0.52 },
  grid_medium: { x: 0.22, y: 0.14, w: 0.46, h: 0.72 },
}

/** Resolve an area to absolute board coordinates. */
export function areaRect(area: AreaId, board: Board = DEFAULT_BOARD): Rect {
  const f = AREA_FRACTIONS[area] ?? AREA_FRACTIONS.full_pitch
  return {
    x: Math.round(f.x * board.width),
    y: Math.round(f.y * board.height),
    w: Math.round(f.w * board.width),
    h: Math.round(f.h * board.height),
  }
}

/** Human-readable bounds for the prompt: "x 644–1372, y 29–691". */
export function areaBounds(area: AreaId, board: Board = DEFAULT_BOARD): string {
  const r = areaRect(area, board)
  return `x ${r.x}–${r.x + r.w}, y ${r.y}–${r.y + r.h}`
}

/**
 * Football principles — the "what must be visible" layer.
 * Each one is geometrically checkable (see ai.validate → validatePrinciples),
 * which turns "is this good football?" from an opinion into arithmetic.
 */
export type PrincipleId =
  | 'forward_play' | 'width' | 'depth' | 'support' | 'speed' | 'penetration'
  | 'compactness' | 'pressing_trigger' | 'cover' | 'overload' | 'possession_security'

export const PRINCIPLE_LABELS: Record<PrincipleId, string> = {
  forward_play: 'immediate forward play — the first action goes toward the opponent goal',
  width: 'width — the attack stretches laterally as it develops',
  depth: 'depth — someone runs beyond the deepest defender',
  support: 'support — the ball carrier always has a nearby option',
  speed: 'speed — the sequence resolves in few phases, no dawdling',
  penetration: 'penetration — net progress toward the opponent goal',
  compactness: 'compactness — the defending unit keeps tight distances',
  pressing_trigger: 'pressing trigger — pressure starts while the ball travels',
  cover: 'cover — every presser has a covering teammate behind him',
  overload: 'overload — numerical superiority around the ball',
  possession_security: 'possession security — options on both sides of the carrier',
}

export interface ConceptCard {
  id: string
  name: string
  keywords: RegExp[]
  /** Where this concept lives on the pitch. */
  area: AreaId
  /** Typical attacking / defending player counts (min, max). */
  attackers: [number, number]
  defenders: [number, number]
  phase: string
  /** How the concept actually works — 3–5 lines, injected into the prompt. */
  how: string[]
  /** Classic mistakes to avoid — the model is told NOT to produce these. */
  avoid: string[]
  /** Football principles this concept MUST demonstrate (validator-checked). */
  principles: PrincipleId[]
  /** The football PROBLEM the scenario poses — a drill with no problem
   *  teaches nothing. Shown as the example the model must adapt. */
  problem: string
  /** Default narrative beats. Coaches read animations as a story:
   *  setup → creation → interaction → decision → final action. */
  arc: string[]
  /** Equipment that belongs (empty = match situation, no cones). */
  equipment?: string
}

export const CONCEPTS: ConceptCard[] = [
  {
    id: 'counter_attack',
    name: 'Counter attack',
    keywords: [/counter.?attack|contra.?ataque|konter|contre.?attaque|kontratak|fast break|transition (to attack|offensive)|turnover/i],
    area: 'full_pitch',
    attackers: [3, 5],
    defenders: [2, 4],
    phase: 'transition — possession just won',
    how: [
      'Starts with a REGAIN in the middle third, not from a settled shape.',
      'The first action after the regain must go FORWARD (carry or pass), never sideways or back.',
      'The furthest attacker (winger/striker) is already sprinting BEFORE the release pass.',
      'Attackers outnumber recovering defenders in the final third — that overload IS the counter.',
      'Ends within 3 phases: regain → release → finish. Longer than that and it is not a counter.',
    ],
    avoid: ['22 players on the board', 'defenders standing still while the attack runs past', 'the ball ending nowhere'],
    principles: ['forward_play', 'speed', 'depth', 'width', 'overload', 'penetration'],
    problem:
      'the recovering defenders outnumber nobody — the attackers must reach the final third BEFORE the defence resets',
    arc: ['ball is won in midfield', 'the winger is released into space', 'defenders scramble to recover', 'the decision: cross, cut inside or shoot', 'the finish'],
  },
  {
    id: 'high_press',
    name: 'High press / pressing trap',
    keywords: [/(?<!counter.?)(?<!gegen)(?<!contra.?)high press|pressing trap|presi[óo]n alta|hohes pressing|pressing haut|y[üu]ksek pres/i],
    area: 'attacking_half',
    attackers: [3, 5],
    defenders: [3, 5],
    phase: 'out of possession — opponent building from the back',
    how: [
      'Our team is OUT of possession: the opponent (red) has the ball near their own goal.',
      'The forward curves his run to cut the pass back to the goalkeeper — the cover shadow.',
      'The wide pass is deliberately left open as bait; the trap springs while the ball travels.',
      'Every presser has a covering teammate behind him at a supporting angle.',
      'The touchline is the extra defender — the trap closes toward it, never toward the middle.',
    ],
    avoid: ['pressing the man instead of the passing lane', 'one presser with no cover', 'trap closing toward the centre'],
    principles: ['pressing_trigger', 'cover', 'compactness', 'overload'],
    problem:
      'the opponent must play out from the back while the passing lanes shrink around him',
    arc: ['goalkeeper starts the build-up', 'the forward cuts the inside lane', 'the pass goes wide as invited', 'the trap closes on the touchline', 'the ball is won'],
  },
  {
    id: 'build_up',
    name: 'Build-up / playing out',
    keywords: [/build.?up|play(ing)? out|salida de bal[óo]n|spielaufbau|relance|opbouw|goal.?kick|from the (goal)?keeper/i],
    area: 'defensive_half',
    attackers: [4, 7],
    defenders: [2, 4],
    phase: 'in possession — first phase',
    how: [
      'Starts with the goalkeeper or a centre-back in the defensive third.',
      'Centre-backs split wide of the box; the pivot drops or rotates to offer the line-breaking option.',
      'Full-backs push high and wide to stretch the first pressing line.',
      'The aim is to beat the FIRST line of pressure, not to reach the goal in one move.',
      'The receiver takes the ball on the half-turn, facing forward wherever possible.',
    ],
    avoid: ['no pressing opponents at all (there is nothing to play out from)', 'long aimless clearance'],
    principles: ['possession_security', 'support', 'width', 'penetration'],
    problem:
      'the first pressing line must be beaten without losing the ball near our own goal',
    arc: ['keeper has the ball', 'centre-backs split, full-backs push high', 'the presser commits', 'the pivot is found on the half-turn', 'the line is broken'],
  },
  {
    id: 'rondo',
    name: 'Rondo',
    keywords: [/rondo|torello|piggy in the middle|keep.?away|one.?touch (passing )?(square|circle)/i],
    area: 'grid_small',
    attackers: [3, 8],
    defenders: [1, 3],
    phase: 'training drill (not a match situation)',
    how: [
      'A DRILL, not a match phase: a small square marked by 4 cones at its corners.',
      'Possession players stand ON the edges of the square, defenders inside it.',
      '"NvM" means exactly N possession players and M defenders — a 4v2 has exactly 6 players.',
      'The ball circulates around the outside; defenders chase inside the grid.',
      'No goals, no goalkeepers, no formation — just the grid, the players and the ball.',
    ],
    avoid: ['using the full pitch', 'goals or goalkeepers', 'a whole team of players'],
    principles: ['support', 'possession_security', 'speed'],
    problem:
      'two defenders press a tight grid — the ball must move faster than they can close',
    arc: ['ball starts on an edge player', 'defenders shift to press', 'the pass across the middle opens', 'the receiver plays first time', 'circulation continues'],
    equipment: '4 cones at the corners of the grid',
  },
  {
    id: 'small_sided_game',
    name: 'Small-sided game',
    keywords: [/small.?sided|ssg\b|\d\s*v\s*\d\s*(game|match)|conditioned game|juego reducido/i],
    area: 'grid_medium',
    attackers: [3, 8],
    defenders: [3, 8],
    phase: 'training game',
    how: [
      'A conditioned game inside a marked area with mini goals at each end.',
      '"NvM" means exactly N players per team plus any explicitly named neutrals.',
      'Cones mark the four corners of the playing area; mini goals sit on the two end lines.',
      'Both teams are present and both shapes must make sense — this is a real game, scaled down.',
    ],
    avoid: ['full-size pitch', 'eleven a side', 'no goals to attack'],
    principles: ['support', 'width', 'penetration', 'overload'],
    problem:
      'a small area with real goals — every possession must produce a scoring chance quickly',
    arc: ['possession starts', 'the team stretches the small pitch', 'an overload forms on one side', 'the decisive pass', 'the finish'],
    equipment: 'corner cones + two mini goals',
  },
  {
    id: 'wing_play',
    name: 'Wing play / crossing',
    keywords: [/overlap|underlap|cross(ing|es)?|cut.?back|byline|wing play|desborde|flanke|centro|banda/i],
    area: 'final_third_wide',
    attackers: [3, 5],
    defenders: [2, 4],
    phase: 'in possession — final third',
    how: [
      'Happens in the wide channel of the final third, near the touchline.',
      'The winger and full-back combine: one goes inside, the other outside — never both the same way.',
      'The delivery comes from close to the byline: a cutback goes BEHIND the retreating defenders.',
      'At least two attackers arrive in the box: near post and penalty spot, at different moments.',
      'The goalkeeper and centre-backs must be present — a cross with nobody defending is meaningless.',
    ],
    avoid: ['crossing from the halfway line', 'no arriving runners', 'no goalkeeper'],
    principles: ['width', 'depth', 'penetration', 'overload'],
    problem:
      'the wide overload must beat the full-back before the centre-backs slide across',
    arc: ['ball reaches the wide channel', 'winger and full-back combine', 'the defence is dragged wide', 'the delivery from the byline', 'the arriving finish'],
  },
  {
    id: 'combination',
    name: 'Combination play (one-two, third man)',
    keywords: [/one.?two|wall.?pass|give.?and.?go|third.?man|pared|doppelpass|une.?deux|combinaci[óo]n|kombination/i],
    area: 'attacking_half',
    attackers: [3, 4],
    defenders: [1, 3],
    phase: 'in possession — progression',
    how: [
      'A short sequence between 2–3 players around one or two defenders.',
      'One-two: firm pass in, immediate run past the defender, return into the space behind.',
      'Third man: A plays into B, B lays off to C who is ALREADY arriving from deep.',
      'The runner starts moving as the FIRST pass travels — that timing is the whole point.',
      'Few players: this is a detail pattern, not a team shape.',
    ],
    avoid: ['static receivers', 'the runner starting after the return pass', 'a full team on the board'],
    principles: ['support', 'speed', 'penetration'],
    problem:
      'a compact defender must be beaten by timing rather than by dribbling',
    arc: ['the first pass is played', 'the runner darts past the defender', 'the defender commits', 'the return into space', 'the progression'],
  },
  {
    id: 'set_piece_corner',
    name: 'Corner kick',
    keywords: [/corner|c[óo]rner|eckball|ecke|rzut ro[żz]ny|escanteio/i],
    area: 'penalty_box',
    attackers: [4, 7],
    defenders: [5, 8],
    phase: 'set piece — attacking corner',
    how: [
      'The ball starts exactly ON the corner arc; the taker stands beside it.',
      'Attackers group near the penalty spot and attack near post / far post / edge at different times.',
      'Defenders mix zonal and man-marking; the goalkeeper is on his line.',
      'Runs are timed: the near-post flick, the back-post arrival, the edge-of-box runner.',
      'Everything happens inside and around the penalty area — this is a box situation.',
    ],
    avoid: ['ball not on the corner', 'no goalkeeper', 'attack starting from midfield'],
    principles: ['depth', 'overload', 'penetration'],
    problem:
      'organised defenders occupy the box — movement and timing must create a free header',
    arc: ['the taker sets up', 'runners take their starting positions', 'the delivery flies in', 'the near-post flick', 'the back-post finish'],
  },
  {
    id: 'set_piece_free_kick',
    name: 'Free kick',
    keywords: [/free.?kick|falta|freisto(ß|ss)|coup franc|rzut wolny|serbest vuru[şs]/i],
    area: 'attacking_third',
    attackers: [3, 6],
    defenders: [4, 7],
    phase: 'set piece — attacking free kick',
    how: [
      'The ball is stationary at the named spot — typically around the edge of the penalty area.',
      'A defensive WALL of 3–4 mannequins or players stands ~9 metres from the ball, between it and the goal.',
      'The goalkeeper positions to cover the far side of his goal.',
      'Attackers set up for the rebound or the second ball; one or two make late runs.',
    ],
    avoid: ['no wall', 'no goalkeeper', 'the ball in open play'],
    principles: ['penetration', 'depth'],
    problem:
      'a wall and a set goalkeeper block the direct route — the ball must beat both',
    arc: ['ball placed, wall set', 'runners position for the second ball', 'the strike', 'the keeper reacts', 'the rebound is attacked'],
    equipment: 'mannequins for the wall (or defenders standing in it)',
  },
  {
    id: 'defending_block',
    name: 'Defensive block / shape',
    keywords: [/low block|mid.?block|defensive shape|compact|bloque bajo|tiefer block|bloc bas|defending as a (team|unit)/i],
    area: 'defensive_half',
    attackers: [2, 5],
    defenders: [8, 10],
    phase: 'out of possession — organised defence',
    how: [
      'Two banks of players (typically 4-4 or 5-3) holding compact distances in our own half.',
      'The whole unit shifts sideways as the ball circulates — spacing between players stays constant.',
      'The block moves on the PASS, while the ball is travelling, not after it arrives.',
      'Depth stays compact: ~25–35 metres between the highest and deepest defender.',
      'Opponents in possession must be present so the shifting has a cause.',
    ],
    avoid: ['individual chasing', 'the shape breaking apart', 'no opponents on the board'],
    principles: ['compactness', 'cover', 'support'],
    problem:
      'the opponent circulates to find a gap — the block must move as one to deny it',
    arc: ['opponent has possession', 'the block shifts with the pass', 'the switch is attempted', 'the unit slides across together', 'the ball is forced backwards'],
  },
  {
    id: 'counterpress',
    name: 'Counterpress',
    keywords: [/counter.?press|gegenpress|contra.?presi[óo]n|five second rule|immediately after losing/i],
    area: 'attacking_half',
    attackers: [3, 5],
    defenders: [2, 4],
    phase: 'transition — possession just lost',
    how: [
      'We have JUST lost the ball in the opponent half — the reaction is immediate, within seconds.',
      'The 2–3 nearest players hunt the new ball carrier from different angles at once.',
      'The player who lost the ball leads the press.',
      'Passing lanes out of the area are closed before the carrier can lift his head.',
      'It ends with the ball won back, not with a settled shape.',
    ],
    avoid: ['dropping back into shape', 'a single presser', 'a slow reaction'],
    principles: ['pressing_trigger', 'overload', 'speed', 'cover'],
    problem:
      'we have just lost the ball high up — it must be won back before the opponent can break out',
    arc: ['possession is lost', 'the nearest players converge', 'passing lanes are closed', 'the carrier is trapped', 'the ball is regained'],
  },
  {
    id: 'finishing',
    name: 'Finishing / shooting drill',
    keywords: [/finishing|shooting|remate|abschluss|torschuss|frappe|strza[łl]|shot on goal/i],
    area: 'attacking_third',
    attackers: [2, 6],
    defenders: [1, 3],
    phase: 'training drill — final action',
    how: [
      'Set in the final third with a full-size goal and a goalkeeper.',
      'A server or feeder supplies the ball; strikers arrive to finish first-time or after one touch.',
      'Cones or mannequins mark the starting positions and any obstacle to beat.',
      'Every repetition ends with a shot at goal — the ball finishes in the goalmouth.',
    ],
    avoid: ['no goalkeeper', 'no goal', 'possession play with no shot'],
    principles: ['penetration', 'depth', 'speed'],
    problem:
      'the striker gets one chance under time pressure from a recovering defender',
    arc: ['the server prepares', 'the striker makes his run', 'the ball is delivered', 'the first touch decides', 'the strike at goal'],
    equipment: 'goal + goalkeeper, cones or mannequins for the starting positions',
  },
]

/** Best-matching concept for a coach prompt (null when nothing matches). */
export function conceptFor(prompt: string): ConceptCard | null {
  for (const c of CONCEPTS) {
    if (c.keywords.some((re) => re.test(prompt))) return c
  }
  return null
}

export function conceptById(id: string): ConceptCard | undefined {
  return CONCEPTS.find((c) => c.id === id)
}

export const AREA_IDS: AreaId[] = Object.keys(AREA_FRACTIONS) as AreaId[]

/** The area block for the prompt, resolved against the caller's board size. */
export function areaCatalogue(board: Board = DEFAULT_BOARD): string {
  return AREA_IDS.map((a) => `- "${a}": ${areaBounds(a, board)}`).join('\n')
}
