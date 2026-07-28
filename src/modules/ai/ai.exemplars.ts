// Tactical-animation exemplar library — template grounding for the AI.
//
// Instead of one fixed worked example, the animation prompt embeds the
// validated exemplar CLOSEST to the coach's request (keyword match). The model
// imitates a relevant, football-correct pattern — the single most effective
// accuracy technique for small/fast models. Every exemplar in this file must
// pass our own validators (enforced by tests/ai-exemplars.test.ts).
//
// Coordinate contract: 1400×720 board, blue (home) attacks left → right,
// red (away) attacks right → left. Keep everything inside 40–1360 / 40–680.

interface ExemplarObject {
  ref: string
  key: string
  type: string
  x: number
  y: number
  props?: { label: string }
}
interface ExemplarFrame {
  moves: { ref: string; to: { x: number; y: number } }[]
}
export interface Exemplar {
  id: string
  /** The "coach request" line shown above the JSON in the prompt. */
  request: string
  /** Multilingual keyword patterns; the exemplar with most hits wins. */
  keywords: RegExp[]
  example: { summary: string; objects: ExemplarObject[]; frames: ExemplarFrame[] }
}

const pl = (ref: string, key: string, x: number, y: number, label: string): ExemplarObject => ({
  ref, key, type: 'player', x, y, props: { label },
})
const blue = (ref: string, x: number, y: number, label: string) => pl(ref, 'player_blue', x, y, label)
const red = (ref: string, x: number, y: number, label: string) => pl(ref, 'player_red', x, y, label)
const football = (x: number, y: number): ExemplarObject => ({ ref: 'ball', key: 'white_ball', type: 'football', x, y })
const cone = (ref: string, x: number, y: number): ExemplarObject => ({ ref, key: 'cone-1', type: 'cone', x, y })
const dummy = (ref: string, x: number, y: number): ExemplarObject => ({ ref, key: 'mannequine-1', type: 'mannequine', x, y })

export const EXEMPLARS: Exemplar[] = [
  {
    id: 'counter-attack',
    request: 'Counter attack down the right, 3 phases',
    keywords: [/counter.?attack|contra.?ataque|konter(?!press)|contre.?attaque|kontratak|transition|turnover|regain|fast break/i, /fast|quick|rápid|schnell|szybk/i],
    example: {
      summary:
        'Regain in midfield, release the right winger early, finish low at the far post. Key point: the 9 attacks the front post the moment the cross is set.',
      objects: [
        blue('h6', 620, 380, '6'), blue('h7', 760, 150, '7'), blue('h9', 800, 360, '9'),
        red('a4', 900, 300, '4'), red('a5', 880, 430, '5'),
        football(640, 380),
      ],
      frames: [
        { moves: [{ ref: 'h6', to: { x: 700, y: 360 } }, { ref: 'ball', to: { x: 705, y: 355 } }, { ref: 'h7', to: { x: 880, y: 120 } }, { ref: 'h9', to: { x: 860, y: 340 } }] },
        { moves: [{ ref: 'ball', to: { x: 985, y: 135 } }, { ref: 'h7', to: { x: 1000, y: 140 } }, { ref: 'h9', to: { x: 1020, y: 330 } }, { ref: 'a4', to: { x: 1000, y: 300 } }, { ref: 'a5', to: { x: 960, y: 420 } }] },
        { moves: [{ ref: 'ball', to: { x: 1180, y: 330 } }, { ref: 'h9', to: { x: 1160, y: 340 } }, { ref: 'h7', to: { x: 1080, y: 180 } }, { ref: 'a5', to: { x: 1100, y: 400 } }] },
      ],
    },
  },
  {
    id: 'high-press',
    request: 'High pressing trap on the touchline, force play wide then swarm',
    keywords: [/(?<!counter.?)(?<!gegen.?)(?<!contra.?)press|presi[óo]n|trap|swarm/i, /high|alt[ao]|hoch|haut|wysoki/i],
    example: {
      summary:
        'The front three cut the pitch in half on the goal kick, invite the pass to the full-back, then spring the trap on the touchline. Key point: the 9 curves his run so the goalkeeper can never come back.',
      objects: [
        blue('h9', 1050, 360, '9'), blue('h7', 1060, 190, '7'), blue('h11', 1060, 530, '11'), blue('h8', 930, 370, '8'),
        red('a1', 1300, 360, '1'), red('a4', 1190, 260, '4'), red('a5', 1190, 460, '5'), red('a2', 1130, 580, '2'),
        football(1290, 350),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 1195, y: 265 } }, { ref: 'h9', to: { x: 1120, y: 310 } }, { ref: 'h7', to: { x: 1130, y: 205 } }, { ref: 'h8', to: { x: 990, y: 330 } }, { ref: 'a5', to: { x: 1210, y: 440 } }] },
        { moves: [{ ref: 'ball', to: { x: 1140, y: 570 } }, { ref: 'h11', to: { x: 1090, y: 545 } }, { ref: 'h9', to: { x: 1160, y: 440 } }, { ref: 'h7', to: { x: 1180, y: 260 } }, { ref: 'a4', to: { x: 1230, y: 280 } }] },
        { moves: [{ ref: 'ball', to: { x: 1105, y: 540 } }, { ref: 'h11', to: { x: 1110, y: 530 } }, { ref: 'h8', to: { x: 1030, y: 460 } }, { ref: 'a2', to: { x: 1180, y: 600 } }] },
      ],
    },
  },
  {
    id: 'build-up',
    request: 'Build-up from the goalkeeper through the thirds against one presser',
    keywords: [/build|aufbau|salida|relance|construc|opbouw|goal.?kick|play.?out|tiki/i, /goalkeeper|portero|torwart|gardien|keeper|gk\b/i],
    example: {
      summary:
        'Goalkeeper starts, split centre-backs stretch the presser, the pivot receives on the half-turn and breaks the first line into the advanced full-back. Key point: the 6 checks his shoulder before every touch.',
      objects: [
        blue('h1', 90, 360, '1'), blue('h4', 210, 230, '4'), blue('h5', 210, 490, '5'), blue('h6', 400, 360, '6'),
        blue('h2', 350, 110, '2'), blue('h3', 350, 610, '3'),
        red('a9', 330, 360, '9'), red('a7', 400, 210, '7'),
        football(110, 360),
      ],
      frames: [
        { moves: [{ ref: 'h5', to: { x: 240, y: 470 } }, { ref: 'ball', to: { x: 243, y: 473 } }, { ref: 'h6', to: { x: 430, y: 430 } }, { ref: 'a9', to: { x: 360, y: 420 } }, { ref: 'h3', to: { x: 430, y: 600 } }] },
        { moves: [{ ref: 'h6', to: { x: 460, y: 400 } }, { ref: 'ball', to: { x: 463, y: 403 } }, { ref: 'a9', to: { x: 420, y: 420 } }, { ref: 'h4', to: { x: 260, y: 240 } }, { ref: 'h2', to: { x: 430, y: 120 } }] },
        { moves: [{ ref: 'h2', to: { x: 560, y: 140 } }, { ref: 'ball', to: { x: 565, y: 145 } }, { ref: 'a7', to: { x: 470, y: 260 } }, { ref: 'h6', to: { x: 520, y: 360 } }] },
      ],
    },
  },
  {
    id: 'switch-of-play',
    request: 'Switch of play with a long diagonal to the far side',
    keywords: [/switch|diagonal|cambio de (banda|juego)|verlagerung|renversement|zmiana strony|side to side/i, /long|larg[oa]|lang|weit/i],
    example: {
      summary:
        'Two quick passes pull the block to one side, then the long diagonal releases the far full-back into space. Key point: the receiving full-back stays wide until the ball leaves the passer’s foot.',
      objects: [
        blue('h6', 600, 380, '6'), blue('h8', 700, 300, '8'), blue('h2', 760, 110, '2'), blue('h3', 680, 600, '3'), blue('h11', 820, 560, '11'),
        red('a6', 760, 300, '6'), red('a3', 830, 170, '3'),
        football(610, 375),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 703, y: 303 } }, { ref: 'h3', to: { x: 760, y: 590 } }, { ref: 'h11', to: { x: 880, y: 540 } }, { ref: 'a6', to: { x: 720, y: 320 } }] },
        { moves: [{ ref: 'h2', to: { x: 830, y: 120 } }, { ref: 'ball', to: { x: 833, y: 123 } }, { ref: 'a3', to: { x: 870, y: 160 } }, { ref: 'h8', to: { x: 760, y: 260 } }] },
        { moves: [{ ref: 'h2', to: { x: 960, y: 150 } }, { ref: 'ball', to: { x: 963, y: 153 } }, { ref: 'a3', to: { x: 930, y: 180 } }, { ref: 'h6', to: { x: 760, y: 340 } }] },
      ],
    },
  },
  {
    id: 'overlap-cross',
    request: 'Right-back overlaps the winger, receives and crosses to the striker',
    keywords: [/overlap|desborde|hinterlaufen|dédoublement|cross|centro|flanke|wing|band[ae]?|full.?back|lateral/i],
    example: {
      summary:
        'The winger cuts inside to drag his marker with him, the full-back attacks the vacated lane and delivers first time. Key point: the striker holds his run until the crosser’s head comes up.',
      objects: [
        blue('h2', 720, 140, '2'), blue('h7', 800, 220, '7'), blue('h9', 880, 360, '9'), blue('h10', 760, 400, '10'),
        red('a3', 900, 200, '3'), red('a5', 980, 330, '5'), red('a1', 1300, 360, '1'),
        football(765, 395),
      ],
      frames: [
        { moves: [{ ref: 'h7', to: { x: 860, y: 280 } }, { ref: 'ball', to: { x: 863, y: 283 } }, { ref: 'h2', to: { x: 840, y: 120 } }, { ref: 'a3', to: { x: 920, y: 240 } }] },
        { moves: [{ ref: 'h2', to: { x: 1000, y: 130 } }, { ref: 'ball', to: { x: 1003, y: 133 } }, { ref: 'h9', to: { x: 1040, y: 330 } }, { ref: 'a5', to: { x: 1060, y: 320 } }, { ref: 'h10', to: { x: 900, y: 380 } }] },
        { moves: [{ ref: 'ball', to: { x: 1150, y: 340 } }, { ref: 'h9', to: { x: 1145, y: 335 } }, { ref: 'a5', to: { x: 1120, y: 360 } }, { ref: 'h7', to: { x: 1000, y: 300 } }] },
      ],
    },
  },
  {
    id: 'rondo',
    request: 'Rondo 5v2, one-touch passing between the outside players',
    keywords: [/rondo|one.?touch|un toque|circulat|keep.?away|piggy|torello|passing (square|circle|drill)/i],
    example: {
      summary:
        'Five outside players keep the ball moving around two pressers; the pass across the middle only comes when both defenders commit to the same side. Key point: receive on the back foot, play the way you face.',
      objects: [
        blue('h2', 700, 170, '2'), blue('h7', 890, 300, '7'), blue('h9', 820, 520, '9'), blue('h4', 580, 520, '4'), blue('h8', 510, 300, '8'),
        red('a6', 660, 360, '6'), red('a8', 740, 380, '8'),
        cone('c1', 470, 150), cone('c2', 930, 150), cone('c3', 930, 560), cone('c4', 470, 560),
        football(690, 190),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 885, y: 305 } }, { ref: 'a6', to: { x: 760, y: 330 } }, { ref: 'a8', to: { x: 700, y: 300 } }] },
        { moves: [{ ref: 'ball', to: { x: 818, y: 515 } }, { ref: 'a8', to: { x: 790, y: 430 } }, { ref: 'a6', to: { x: 730, y: 400 } }] },
        { moves: [{ ref: 'ball', to: { x: 585, y: 517 } }, { ref: 'a6', to: { x: 650, y: 450 } }, { ref: 'a8', to: { x: 700, y: 420 } }] },
      ],
    },
  },
  {
    id: 'corner-kick',
    request: 'Attacking corner: near-post flick on to the back-post runner',
    keywords: [/corner|c[óo]rner|eckball|ecke|rzut ro[żz]ny|k[öo][şs]e|escanteio/i, /near.?post|back.?post|far.?post|flick|primer palo|segundo palo/i],
    example: {
      summary:
        'Inswinger to the near post, the 9 flicks it across, the 4 arrives late at the back post. Key point: the back-post runner starts his move only when the taker raises his arm.',
      objects: [
        blue('h7', 1320, 665, '7'), blue('h9', 1180, 420, '9'), blue('h4', 1150, 300, '4'),
        red('a5', 1230, 400, '5'), red('a1', 1330, 360, '1'),
        football(1350, 670),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 1280, y: 415 } }, { ref: 'h9', to: { x: 1270, y: 410 } }, { ref: 'h4', to: { x: 1240, y: 310 } }, { ref: 'a5', to: { x: 1255, y: 425 } }] },
        { moves: [{ ref: 'h4', to: { x: 1300, y: 330 } }, { ref: 'ball', to: { x: 1305, y: 335 } }, { ref: 'a1', to: { x: 1315, y: 340 } }, { ref: 'h9', to: { x: 1285, y: 395 } }] },
        { moves: [{ ref: 'ball', to: { x: 1345, y: 355 } }, { ref: 'h4', to: { x: 1310, y: 345 } }, { ref: 'a1', to: { x: 1330, y: 350 } }] },
      ],
    },
  },
  {
    id: 'free-kick',
    request: 'Attacking free kick from the edge of the box over the wall',
    keywords: [/free.?kick|falta|freisto(ß|ss)|coup franc|rzut wolny|serbest|set.?piece/i, /wall|barrera|mauer|mur|bariera/i],
    example: {
      summary:
        'Direct free kick from the edge of the box: struck up and over the mannequin wall towards the far corner while the 9 attacks the rebound line. Key point: the runner times his move with the strike, never before.',
      objects: [
        blue('h10', 1110, 290, '10'), blue('h9', 1160, 450, '9'),
        dummy('m1', 1190, 320), dummy('m2', 1192, 344), dummy('m3', 1194, 368),
        red('a1', 1330, 370, '1'),
        football(1140, 300),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 1280, y: 330 } }, { ref: 'h9', to: { x: 1240, y: 430 } }, { ref: 'a1', to: { x: 1320, y: 340 } }] },
        { moves: [{ ref: 'ball', to: { x: 1350, y: 345 } }, { ref: 'a1', to: { x: 1335, y: 350 } }, { ref: 'h9', to: { x: 1290, y: 400 } }] },
      ],
    },
  },
  {
    id: 'third-man-run',
    request: 'Third-man combination: pass into the striker, lay-off, runner from deep',
    keywords: [/third.?man|tercer hombre|dritte[rn]? mann|troisi[èe]me homme|trzeci/i, /combinat|combinaci|kombinat|lay.?off/i],
    example: {
      summary:
        'The 6 plays into the striker’s feet, the lay-off finds the 8 arriving from deep beyond the marker. Key point: the third man starts his run as the FIRST pass is played — that is what makes him unmarkable.',
      objects: [
        blue('h6', 600, 400, '6'), blue('h8', 750, 300, '8'), blue('h9', 850, 420, '9'),
        red('a6', 700, 350, '6'),
        football(610, 395),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 845, y: 415 } }, { ref: 'h8', to: { x: 830, y: 240 } }, { ref: 'a6', to: { x: 760, y: 360 } }] },
        { moves: [{ ref: 'h8', to: { x: 920, y: 250 } }, { ref: 'ball', to: { x: 923, y: 253 } }, { ref: 'h9', to: { x: 870, y: 400 } }, { ref: 'a6', to: { x: 810, y: 330 } }] },
        { moves: [{ ref: 'h8', to: { x: 1040, y: 260 } }, { ref: 'ball', to: { x: 1043, y: 263 } }, { ref: 'h6', to: { x: 760, y: 380 } }] },
      ],
    },
  },
  {
    id: 'one-two',
    request: 'One-two around the defender: give and go into the space behind',
    keywords: [/one.?two|give.?and.?go|wall.?pass|pared|doppelpass|une.?deux|klepka/i],
    example: {
      summary:
        'The 7 gives, darts behind the full-back, and takes the return in stride. Key point: the first pass must be firm — a soft pass gives the defender time to turn.',
      objects: [
        blue('h7', 800, 200, '7'), blue('h9', 900, 300, '9'),
        red('a2', 860, 220, '2'),
        football(795, 205),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 895, y: 295 } }, { ref: 'h7', to: { x: 880, y: 160 } }, { ref: 'a2', to: { x: 850, y: 190 } }] },
        { moves: [{ ref: 'h7', to: { x: 950, y: 180 } }, { ref: 'ball', to: { x: 953, y: 183 } }, { ref: 'a2', to: { x: 900, y: 200 } }] },
        { moves: [{ ref: 'h7', to: { x: 1060, y: 220 } }, { ref: 'ball', to: { x: 1063, y: 223 } }, { ref: 'h9', to: { x: 940, y: 290 } }] },
      ],
    },
  },
  {
    id: 'block-shift',
    request: 'Low block shifting side to side with the opposition circulation, compact lines',
    keywords: [/block|bloque|bloc|niski blok|defend|defensive shape|shift|slide|verschieben|bascul/i, /compact|kompakt|lines|l[íi]neas/i],
    example: {
      summary:
        'Two banks of four slide as one unit while the opposition circulates. Key point: the whole block moves on the PASS, not on the reception — shift while the ball travels.',
      objects: [
        blue('h2', 300, 150, '2'), blue('h4', 280, 300, '4'), blue('h5', 280, 420, '5'), blue('h3', 300, 570, '3'),
        blue('h7', 420, 160, '7'), blue('h8', 400, 310, '8'), blue('h6', 400, 410, '6'), blue('h11', 420, 560, '11'),
        red('a8', 600, 300, '8'), red('a2', 640, 120, '2'),
        football(605, 295),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 645, y: 125 } }, { ref: 'h2', to: { x: 330, y: 130 } }, { ref: 'h7', to: { x: 460, y: 140 } }, { ref: 'h4', to: { x: 300, y: 260 } }, { ref: 'h8', to: { x: 430, y: 270 } }, { ref: 'h5', to: { x: 300, y: 390 } }, { ref: 'h6', to: { x: 430, y: 380 } }] },
        { moves: [{ ref: 'a2', to: { x: 700, y: 130 } }, { ref: 'ball', to: { x: 703, y: 133 } }, { ref: 'h2', to: { x: 360, y: 120 } }, { ref: 'h7', to: { x: 500, y: 140 } }, { ref: 'h4', to: { x: 320, y: 250 } }] },
        { moves: [{ ref: 'a8', to: { x: 650, y: 310 } }, { ref: 'ball', to: { x: 653, y: 313 } }, { ref: 'h8', to: { x: 450, y: 300 } }, { ref: 'h6', to: { x: 440, y: 390 } }, { ref: 'h2', to: { x: 340, y: 140 } }] },
      ],
    },
  },
  {
    id: 'counterpress',
    request: 'Counterpress immediately after losing the ball in the final third',
    keywords: [/counter.?press|gegenpress|contra.?press|immediate|after losing|tras p[ée]rdida|rest.?def|5.?second/i],
    example: {
      summary:
        'The instant the ball is lost, the three nearest players hunt it for five seconds before the shape resets. Key point: press the FIRST touch of the winner — that is when he is blind.',
      objects: [
        blue('h8', 800, 350, '8'), blue('h7', 850, 250, '7'), blue('h2', 760, 180, '2'),
        red('a6', 820, 330, '6'), red('a8', 900, 380, '8'),
        football(825, 335),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 895, y: 375 } }, { ref: 'h8', to: { x: 860, y: 360 } }, { ref: 'h7', to: { x: 880, y: 300 } }, { ref: 'a6', to: { x: 840, y: 320 } }] },
        { moves: [{ ref: 'a8', to: { x: 920, y: 400 } }, { ref: 'ball', to: { x: 923, y: 403 } }, { ref: 'h8', to: { x: 890, y: 370 } }, { ref: 'h2', to: { x: 820, y: 220 } }] },
        { moves: [{ ref: 'h8', to: { x: 910, y: 395 } }, { ref: 'ball', to: { x: 913, y: 398 } }, { ref: 'h7', to: { x: 940, y: 340 } }, { ref: 'a8', to: { x: 950, y: 420 } }] },
      ],
    },
  },
  {
    id: 'cutback-finish',
    request: 'Winger reaches the byline and cuts it back to the arriving midfielder',
    keywords: [/cut.?back|pase atr[áa]s|centre en retrait|r[üu]ckpass|byline|baseline|l[íi]nea de fondo/i, /finish|remate|abschluss|shot|goal/i],
    example: {
      summary:
        'The 7 beats his man to the byline, the near-post runners drag the defence deep, and the cutback finds the 10 arriving on the penalty spot. Key point: the cutback goes BEHIND the retreating defenders.',
      objects: [
        blue('h7', 1150, 120, '7'), blue('h9', 1150, 350, '9'), blue('h10', 1050, 380, '10'),
        red('a4', 1200, 330, '4'), red('a1', 1330, 360, '1'),
        football(1145, 125),
      ],
      frames: [
        { moves: [{ ref: 'h7', to: { x: 1290, y: 100 } }, { ref: 'ball', to: { x: 1293, y: 103 } }, { ref: 'h9', to: { x: 1220, y: 360 } }, { ref: 'h10', to: { x: 1090, y: 380 } }, { ref: 'a4', to: { x: 1240, y: 350 } }] },
        { moves: [{ ref: 'h10', to: { x: 1190, y: 385 } }, { ref: 'ball', to: { x: 1193, y: 388 } }, { ref: 'a4', to: { x: 1260, y: 370 } }, { ref: 'h9', to: { x: 1270, y: 380 } }] },
        { moves: [{ ref: 'ball', to: { x: 1340, y: 375 } }, { ref: 'h10', to: { x: 1210, y: 390 } }, { ref: 'a1', to: { x: 1325, y: 368 } }] },
      ],
    },
  },
  {
    id: 'press-resistance',
    request: 'Playing through pressure: pivot escapes the press on the blind side',
    keywords: [/resist|escape|play(ing)?.?through|under pressure|salir de la presi[óo]n|[üu]berspielen|beat the press|break the press/i, /pressure|presi[óo]n|druck|pression/i],
    example: {
      summary:
        'Pressed from two sides, the 6 bounces it back to the centre-back, spins away on the blind side and receives again facing forward. Key point: the bounce pass is a trigger, not a retreat.',
      objects: [
        blue('h6', 400, 360, '6'), blue('h4', 250, 280, '4'), blue('h3', 350, 600, '3'),
        red('a9', 360, 340, '9'), red('a7', 440, 320, '7'),
        football(395, 365),
      ],
      frames: [
        { moves: [{ ref: 'ball', to: { x: 255, y: 285 } }, { ref: 'h6', to: { x: 470, y: 420 } }, { ref: 'a9', to: { x: 300, y: 310 } }, { ref: 'a7', to: { x: 450, y: 360 } }] },
        { moves: [{ ref: 'ball', to: { x: 473, y: 423 } }, { ref: 'a7', to: { x: 460, y: 390 } }, { ref: 'h3', to: { x: 430, y: 590 } }] },
        { moves: [{ ref: 'h3', to: { x: 520, y: 580 } }, { ref: 'ball', to: { x: 523, y: 583 } }, { ref: 'a9', to: { x: 380, y: 360 } }] },
      ],
    },
  },
]

/**
 * Pick the exemplar whose keywords best match the coach's request.
 * keywords[0] is the primary pattern (worth 2 points); the rest refine (1
 * point each) — so a topic hit always beats an incidental adjective hit.
 */
export function exemplarFor(prompt: string): Exemplar {
  let best = EXEMPLARS[0]
  let bestScore = 0
  for (const ex of EXEMPLARS) {
    const score = ex.keywords.reduce((n, re, i) => n + (re.test(prompt) ? (i === 0 ? 2 : 1) : 0), 0)
    if (score > bestScore) {
      best = ex
      bestScore = score
    }
  }
  return best
}
