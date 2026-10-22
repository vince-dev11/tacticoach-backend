# Deploy — editor items 1–8 (17 Oct 2026)

This builds items 1–8 from `Editor_Roadmap_Research_2026-10-17.md`, following the brief in `Brief_Editor_Items_1-8_2026-10-17.md`. It is **frontend only**, so no API deploy is needed. Everything new is optional data on the board: older boards open and play exactly as before.

## What a coach gets

### 1 · Timing inside a frame
- In Movement, **select a player who runs in this move**. The frame's row shows **"8 starts: With the frame · After the pass · After the touch"**.
- The run waits, then fills the rest of the frame. It is never left less than 0.6 s to run.
- "After the touch" makes the pass arrive by half-way, so there is time to take a touch and then run.
- With no pass in the move, only "With the frame" can be picked, and the other choices say why.
- It plays the same in 2D, 3D/Stadium, both videos, the library Watch, the share link and books.

### 2 · Teach on the board
- Each move has a **Teach** button on its row: spotlight a player, show where a player is looking (the ball, the run, or another player), and add a **stop-and-think question**.
- **Play stops on the question** until Continue (or Space), then the move plays.
- During the move the spotlight dims everyone else and rings the player, and the vision cone follows play.
- The **2D MP4 holds the question for 3.5 s as its caption**, then plays the move.
- The library Watch and the share link play the same teaching, using the books' player.

### 3 · Rotations and queues
- **Draw → "Then goes to" (R):** a dotted arrow with an open head, for where a player goes next. It never animates.
- **Select a cone → "Players waiting here" (− / +):** draws a short stack behind the cone with a ×N badge.
- The practice card shows **"N waiting"**. Over 5 in a line, it says *"A line of 7 — think about two stations, so nobody waits long."*

### 4 · Pitch overlays
- **Field → Show on the pitch** gains three toggles:
  - **Thirds** and **Offside line**: full pitches only.
  - **5 lanes**: any pitch. On a pitch with boxes the lanes run along the box edges; on a plain box the width is split in five.
- **The offside line follows Law 11:** the second-last defender (keeper included) or the ball, whichever is nearer the goal line, drawn only in the defending team's half.
- Which goal a team defends comes from its keeper.
- The line moves with play, including in the video. Overlays are saved with the board.

### 5 · Pass type
- In Movement, **select the ball** where it is passed: **Auto · Into feet · Into space · Driven · Lofted**.
  - **Auto** is the old behaviour.
  - **Lofted** goes in the air at any length.
  - **Driven** arrives by 45% of the frame.
  - **Into space** rolls out to where it was drawn instead of snapping to feet.

### 6 · "Learn it before training" link
- Share → **Copy a link to watch it** (added this morning). The public page now asks the board's stop-and-think questions and waits for Continue.
- No names: the share API already strips them. No price on that page.

### 7 · Cover shadow
- **Player panel → Cover shadow.** A fading wedge behind the presser, away from the ball, drawn only within 20 m of the ball.
- It follows play, including in the video.

### 8 · More examples that play
Six new ones; there are now **11 animated examples**:

| Example | What it shows |
|---|---|
| Switch of play | Draw them in, back and across, switch (three beats) |
| Overlap | Winger carries inside, full-back overlaps, played round the defender |
| Third-man run | Into the 6 as the wall, set for the runner beyond |
| Rondo 4v2 — win it, get out | Two defenders win it and escape the square |
| Counter-press | Nearest two press, force the pass back, win it |
| Low block | Two banks of four shift to the ball, then squeeze |

Copy is in all 7 languages, written with gender-neutral English. Every example passes the football-clean test automatically.

## Not done yet (honest gaps)

| What | Status |
|---|---|
| **3D / Stadium** | Spotlight, vision cone, overlays and cover shadow are drawn in 2D only. Stop-and-think pauses work in every view of the editor, and timing and pass types are in every view. |
| **3D/Stadium video** | Does not hold the stop-and-think questions (the 2D MP4 does). |
| **"Loop the drill with players rotated"** | Not built. Rotation arrows and queues show the organisation, but the board doesn't replay the rotation. |
| **Visual check** | I could not see the new build in a browser (no local browser here). The Playwright specs below and the post-deploy check cover it. |

## Checks run

- **`npm run typecheck`:** clean.
- **eslint on all 40 changed files:** clean.
- **`vite build`:** OK.
- **Full unit suite: 203 files, 2,785 tests, all pass.** I ran the full suite because the store, locales and Konva build changed.
- **The suite caught one real bug before shipping:** vision cones and cover shadows use Konva's *Wedge*, which our slim Konva build did not include. It would have been a blank or crashing board in production. It is now registered.

**New tests:**
- `boardTeach` (10)
- `pitchOverlays` (10)
- `runTiming` (6)
- `runStartControl` (3)
- `passType` (7)
- `queuesRotation` (7)
- `coverShadowLearnLink` (5, including the share player stopping on a question)
- `templateBeats`: the football-clean checks now run on all 11 examples.

**Updated:**
- `pitchLook`: the saved display now carries the three overlay switches.
- `templateNumbers`: counts for the six new examples.

## Please run (on your Mac, one at a time)

```
npm run test:e2e:live -- editor.spec editor-full.spec pitchfirst.spec stadium-360.spec
```
```
npx playwright test -c playwright.tablet.config.ts tablet-editor.spec
```

New live tests are in `editor.spec`, "editor items — 17 Oct":
- **TEACH:** play stops on the question, Continue plays on.
- **OVERLAYS:** the three toggles switch on and are kept.

## Deploy (web only)

```
cd tacticoach-frontend && git add -A && git commit -m "Editor: timing inside a frame, teach layer, rotations & queues, thirds/lanes/offside, pass types, cover shadow, 6 new animated examples" && git push
# server
cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
```

## Check after deploy (10 minutes, on the live editor)

1. **Ready-made drills → Third-man run:** it plays. Select #8 in frame 2 → **After the pass**, then play: #8 waits for the ball to leave.
2. **Teach on frame 1:** spotlight a player and write a question, then Play. It stops; Continue plays on.
3. **Field → Thirds, 5 lanes, Offside line** on a full pitch: the lines appear, and the offside line moves while it plays.
4. **Draw → Then goes to.** Select a cone and set "Players waiting here" to 7: the stack and the two-stations hint appear.
5. Select the ball in a passing frame → **Lofted**: it goes in the air in 3D.
6. Turn on **Cover shadow** for a presser near the ball: a wedge appears behind them.
7. **Share → Copy a link** on a board with a question: the public page stops on it.

## Coach acceptance review (football-product-expert)

**For:** grassroots and academy coaches building and showing practices; players watching the link before training.

**Would I use it on Tuesday night?** Yes.
- **Timing** fixes the thing coaches have actually complained about: a third-man run or an overlap now *starts when it should*, instead of being faked across two frames.
- **Stop-and-think** turns the board from "watch it go round" into a teaching moment. The same question goes home with the players via the link.
- **Queues and rotation arrows** make a passing drill's organisation readable at a glance, and the card nudges towards shorter lines.

| Area | Verdict |
|---|---|
| Coach workflow | PASS. Every new control sits where the thing it changes is: the move's row, the selected player or ball, the cone. Nothing new is on the pitch unless switched on. |
| Football correctness | PASS. Offside follows Law 11; lanes come from the real box edges; the examples are football-clean by automated test; "after the touch" gives the receiver time to take it. |
| Ease of use | PASS, with one watch-point. Timing and pass type appear only when a runner or the ball is selected in Movement. Coaches must be shown once; worth a help tip or a short tour step next. |
| During training (tablet) | PASS for the controls (finger-sized on touch screens). The stop-and-think Continue button is large. |
| Animation | PASS in 2D, the 2D video and Watch. PARTLY in 3D: timing and pass types are there, the teaching shapes are not yet (see gaps). |

**Solves the stated problems:** YES for items 1, 2, 4, 5, 6 and 8. PARTLY for item 3 (no rotation replay) and item 7 (2D only).

**Verdict:** ship after your Playwright run is green. No Critical findings. The Important follow-ups are a discovery tip for the timing and pass controls, and the teaching shapes in 3D.
