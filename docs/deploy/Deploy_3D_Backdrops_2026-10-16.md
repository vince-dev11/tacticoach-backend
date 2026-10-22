# Deploy: 3D surroundings — Training ground, Night session, Studio (16 Oct 2026)

Level 3 (new option). Web only; no API change, no migration.

## What the coach gets

The 3D view's backdrop was one hard-coded look: a black floor with a green grid and large glowing logos. The pitch floated in a void and the picture read as software, not football.

Now the 3D view has a **Surroundings** choice in its camera bar (top right), a fixed set of three — one tap, every video stays something we'd put our name on:

| Choice | What it shows | For |
|---|---|---|
| **Training ground** (default) | Daylight: grass to the horizon with mown stripes, a tree line, a low white rail round the pitch, a kit bag and cones by the touchline, floodlight masts, one modest board on the far side (the club's when the coach has set one, ours otherwise) | Most boards: grassroots and academy sessions |
| **Night session** | The same ground under floodlights: a dark sky, the masts lit with halos, the pitch the lit thing, the ground dim | Evening training; social clips |
| **Studio** | Today's look — black floor, green grid, the neon logos (now a third smaller) | Presentations, the website, dark-mode posts |

The **Stadium** view keeps its bowl and shows no choice. The choice is saved with the board (`tcMeta.backdrop3d`) and remembered as the coach's default for new boards (`tc_backdrop_3d`); an older board opens with the coach's default. The 3D video, the library's live player and the book pages all draw through the same `lookFor`, so they follow the board.

Not a free colour picker on purpose: a coach on a touchline won't tune a sky, and a picker makes ugly results easy and support hard. Kits and pitch patterns are curated choices too.

## Files

- `src/editor/types.ts` — `Backdrop3d`, `BACKDROPS_3D`, `DEFAULT_BACKDROP_3D`, `isBackdrop3d`
- `src/editor/store.ts` — `backdrop3d`, `setBackdrop3d`, load/save, `tc_backdrop_3d`
- `src/editor/fabric-io.ts`, `steps.ts`, `autosave.ts` — saved with the board, autosaved
- `src/editor/stadiumLook.ts` — `Look.backdrop`
- `src/editor/stadiumRender.ts` — `drawGround` (training/night), sky per backdrop, run-off on grass, one board on the far side (not from the TV camera), studio neon smaller
- `src/editor/StadiumCamera.tsx`, `StadiumView.tsx`, `editor.css` — the themed select (`data-testid="backdrop-select"`), 3D only; the background cache key includes the backdrop
- Copy: `canvas.backdropLabel / backdropTraining / backdropNight / backdropStudio` in all 7 locales (+ en-US overlay)
- Tests: `tests/unit/backdrop3d.test.ts` (new, 9), `tests/e2e-live/stadium-360.spec.ts` BD-01 (new)

## Checked

- Unit: backdrop3d, stadiumView, stadiumVideo, stadiumOrbit, stadiumVideoModal, adminControlsThemed, noHardcodedCopy, i18nParity, terminology — 544 pass. Typecheck and eslint clean.
- In Chrome (local dev): all three looks from the high camera, a 45° corner camera and the TV camera; the select is themed (dark, no white browser control); switching redraws at once; the choice survives Save → reload with the default reset; the Stadium view shows no select.
- **Not run:** the live Playwright spec BD-01 (`npx playwright test -c playwright.live.config.ts stadium-360.spec.ts`) — please run it. The 3D video was not exported end to end; it uses the same `lookFor` path.

## Coach acceptance review

- Would I use it on Tuesday night? Yes: the default now looks like where I coach, and Night session is what my evening videos should look like.
- Coach workflow: PASS — one control, next to the camera buttons, remembered.
- Football correctness: PASS — nothing tactical changes.
- Ease of use: PASS — three named choices, no settings.
- Optional: the TV camera at life size rarely shows the sky; the tree line is a band at the top. A low "pitch-side" camera preset would show the surroundings off — later.

## Deploy

```bash
cd /var/www/html/tacticoach-frontend && bash scripts/deploy-web.sh
```
Then hard-refresh and open any board in 3D.
