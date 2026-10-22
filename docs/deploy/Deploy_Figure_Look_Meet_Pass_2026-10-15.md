# Deploy: the real player's look, the pass timed into the run, editor end-to-end (15 Oct 2026)

Both from coach feedback. Web only; no API change, no migration.

## 1. The pass meets the runner (MEET) — level 2, animation correctness

**The coach said:** the round player and the ball reach the spot at slightly different times.

**What was wrong:** a pass to a *running* receiver rolled at its own pace (struck, slowing on the grass). It reached the spot first and sat waiting while the player ran up to it — a 15 m pass into a 10 m run arrived 0.5 s early, a short pass into a long run over a second early — or it overtook him on the way.

**Now:** a pass to a receiver who runs in the frame is timed into his run. The passer holds it a moment (at most 0.5 s, the way a real passer lets the run get going; BALL-NOW's "the ball leaves quickly" still holds) and past that the ball is played softer, so the ball and the runner arrive together at the frame's end. A runner who carries on into the next frame takes it in his stride (no planted first touch); one who stops takes a touch, and that touch finishes in the next frame instead of being cut at the boundary. A pass to a *standing* receiver is unchanged.

**One plan, every look:** the timing lives in the shared motion plan, so round players and figures, the 2D board, 3D, Stadium, the videos and the library player all play the same picture. The figures had the same gap — their running pose just hid it.

Files: `src/editor/motionPlan.ts` (`passProfile(meetAt)`, `MEET_HOLD_S`, `play.inStride`), `src/editor/playEvents.ts` (`frameCues(prev)`), `src/editor/geometry.ts`, `AnimationTimeline.tsx`, `stadiumFrames.ts`, `videoExport.ts`. Tests: `tests/unit/meetPass.test.ts` (new), `ballSync.test.ts` (updated for the hold).

## 2. The real player's look (LOOK) — level 2, visual only

**The coach said:** the real player should look beautiful.

**What was wrong:** the 2D figure was flat fills with a black line — clip-art. (The 3D/Stadium figure was already shaded, and is unchanged.)

**Now (16 Oct, after the owner's reference picture — a cel-shaded vector footballer):** the figure is drawn in that illustration style, as an original:
- **an athlete's build** — broad shoulders, full thighs, calves that swell below the knee, forearms and hands (loosely closed, as a runner's), a thicker neck — drawn around the same bones, so every pose is as before;
- **cel shading** — a hard shadow on the side away from the light on every limb, the shirt, the face and the hair; the outline is a darker tone of each colour, not a black line;
- **a face** — hair with volume (swept up, curly, fade, bob, ponytail, braid, bun), an eye with a catch-light, a brow, an ear, a nose, a mouth, and a beard on about a third of the men;
- **the kit** — a collar and sleeve cuffs in the trim colour, a sock band in the shorts' colour, a side stripe on the shorts, proper boots with a sole and studs;
- a soft two-level ground shadow.

The 3D/Stadium figure was already cel-shaded and is unchanged. Details are skipped below about 24–30 px tall, so a small board stays clean and fast; playback holds 60 fps with 22–40 figures. The realism gates (joints) still pass. Checked in Chrome standing, running, with the ball, men and women, both kits, at 1×, 1.6×, 2.4× and 3.2×.

Files: `src/editor/playerFigure.ts` (`cel`, `limb`, `blob`, `outlineOf`, `shadowOf`; `FigureLookT.beard`). Tests: `tests/unit/playerFigure.test.ts` (the cel shadow is drawn; a minimal 2D context still draws).

## Checked

- Unit: motionPlan, meetPass, ballSync, playEvents, motion, beat3s, ballSound, realPlayersMatch, passTool, playerFigure, boardFigure, matchFigure, timelineSettings, qaEditor, editorPitchFirst, orbitMotion — all pass. Realism gates (`realism.test.ts`, `sweep.test.ts`, 344 measurements) pass. Typecheck and eslint clean.
- **Editor end to end in Chrome (local dev, owner account):** formations for both teams · Real players (Mixed) · toolbox open/close over the pitch · move a player in Set up · Draw: run arrow and zone with its style panel · Movement: Frame 1, two runs recorded by dragging the figures, a pass with the Pass tool, played: the ball met the runner · frame length set to 4 s · Add frame · settings card · full screen with play, speed, 2D/3D/Stadium and Exit · Stadium playing in full screen · Shift+F focus and Esc · Save with category and age group (private by default) · reload from the API: title, 3 frames, durations, figure look, 3 runs all back · Share menu · Clear the board confirm (themed) · no console errors.
- The owner's unsaved drafts were backed up before the test and restored after it. Board 24 "E2E figures and MEET pass (Claude)" was saved in the local dev database; delete it from the library if unwanted.

## Noticed, not changed (for the owner)

1. **A ball added while standing on Frame 1 belongs to Frame 1 only** (by design for cones: "added on frame N → frame N only"). It vanishes in Frame 2, with only a small "F1" badge to say why. A coach who forgets the ball in Set up and adds it in Movement will lose it. Suggest: players and the ball default to every frame; equipment keeps the frame scope. Important.
2. The Pass tool stays armed ("click a receiver") after a pass and across frames. Optional: disarm after one pass.
3. The save dialog's age groups are the English bands (U7 … Senior). Global-by-design says bands vary by country; fine for the UK launch, worth a country setting later. Optional.
4. After playback ends, the board snaps from where the plan put the ball (at the receiver's feet) to where it was drawn (the Pass tool's spot, a few metres off). Pre-existing; cosmetic. Optional.

## Deploy

```bash
cd /var/www/html/tacticoach-frontend && bash scripts/deploy-web.sh
```
Then hard-refresh and open any board with real players and a pass into a run.
