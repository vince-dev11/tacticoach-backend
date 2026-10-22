# Deploy — editor scan fixes E-01 … E-09 (17 Oct 2026)

These fix every finding in `Editor_E2E_Scan_2026-10-17.md`. All changes are frontend only, so **no API deploy** is needed.

## What changed for a coach

| # | Fix |
|---|---|
| **E-01** (Critical) | After Play, **Set up** and **Start positions** show the start again, and a Set up drag moves the start. Before, it moved the **last frame's** start, so a coach's drill was quietly changed. Save always stores the set-up picture, an older board saved on its end picture opens on its start, and the library thumbnail shows the set-up. |
| **E-02** | 3D and Stadium: the frames bar is just the frames. The note row that crushed it and **+ Add frame** stay in 2D, because 3D is for watching. |
| **E-03** | "Unsaved work found" folds into a small chip in the pitch's corner after 7 seconds or at the coach's first change. The draft is kept, and tapping the chip opens it again. Watching a board no longer counts as unsaved work. The draft's age is now in the coach's language; it used to be English-only "min ago". |
| **E-04** | Narrow screens and upright tablets: mode tabs never wrap, the logo steps aside under 1000 px (Back still goes home), and the board name gets the room. On an upright tablet with a landscape pitch, one line says once "Turn it sideways and the pitch fills the screen". |
| **E-05** | The examples are football-clean. Counter 3v2: #9 fixes #5, the pass is released **round** the fixed defender (not through him), #4 tracks #9, and the keeper shifts. Crossing: #4 ends goal-side of #9, not inside him. High press: #10 screens their 6 from his shoulder. A new test checks every example on the plan every view plays: nobody stands on anybody, and no pass rolls through a player. |
| **E-06** | A ball dropped on a player rests **at his feet** on the side it came from, never over his number. |
| **E-07** | Share → **Copy a link to watch it**. A public board copies at once. A private board asks first ("Anyone with the link can watch… players' names are left out"). Yes makes it public; No copies nothing. An unsaved board shows "Save the board first". |
| **E-08** | Greyed "Ready-made drills" says why: "Ready-made drills are added in Set up, in 2D." |
| **E-09** | 3D / Stadium's automatic camera frames **the practice** (players, ball, cones, goals, through every frame, plus 6 m). A practice using most of the pitch still sees all of it. The 3D video and the library's 3D Watch frame it the same way. TV and a camera the coach turned are unchanged. |

## Files

**Code:**

- `src/editor/`
  - `store.ts` (`setMode`, `loadState`, `objectsAtFrameStart` exported)
  - `steps.ts` (`liveBoard`, `withSetupPicture`)
  - `TopToolbar.tsx` (thumbnail, Copy link, menu hint)
  - `AnimationTimeline.tsx`
  - `autosave.ts`
  - `BoardCoach.tsx`
  - `templates.ts`
  - `ballFeet.ts` (new)
  - `PitchCanvas.tsx`
  - `api.ts` (`boardIsPublished`)
  - `stadiumFit.ts` (new)
  - `stadiumRender.ts` (`View.fit`)
  - `StadiumView.tsx`
  - `stadiumFrames.ts`
  - `editor.css`
- `src/pages/Editor.tsx` (draft chip)

**Copy (7 locales + en-US):**

- `coach.turnSideways`
- `editor.exportLink`, `copyLink`, `copyLinkNeedsSave`, `copyLinkConfirm`, `copyLinkMakePublic`, `linkCopied`, `linkFailed`
- `editor.templatesInSetup`

**Tests (new):**

- `setupPicture` (7)
- `draftOffer` (4)
- `tabletUpright` (3)
- `ballFeet` (5)
- `editorShareLink` (5)
- `stadiumFit` (5)

**Tests (extended):**

- `templateBeats` (E-05 football-clean checks on every example)
- `editorPitchFirst` (E-02)

## Checks run

- `npm run typecheck`: clean.
- eslint on every changed file: clean.
- `vite build`: OK.
- **Full unit suite: 196 files, 2,650 tests, all pass.** I ran the whole suite (not just the editor tests) because the store and locales changed.
- E-01 failed first: the test showed a Set up drag after Play editing the **last frame**. It was fixed, then went green.

## Please run (Playwright, on your Mac)

```
npm run test:e2e:live -- editor.spec editor-full.spec pitchfirst.spec stadium-360.spec
npx playwright test -c playwright.tablet.config.ts tablet-editor.spec
```

New live tests are in `editor.spec`, "editor scan fixes — 17 Oct":

- **E-01:** play, then Set up shows the start.
- **E-02:** 3D frames bar.

## Deploy

```
cd tacticoach-frontend && git add -A && git commit -m "Editor scan fixes E-01..E-09: set-up picture after play, 3D frames bar, draft chip, tablet header, clean examples, ball at feet, copy link, menu hints, 3D frames the practice" && git push
# server
cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
```

## Check after deploy (5 minutes)

1. Open a board with movement, press Play, let it finish, click **Set up**. Players are back on their start positions.
2. Save, reload: it opens on the start. The library thumbnail shows the start.
3. 3D: the frames bar shows every frame, with no note box. The camera is closer on a half-pitch practice.
4. Drop the ball on a player in Movement: it rests at his feet with his number visible.
5. Share → Copy a link on a private board: you are asked first.

## Coach acceptance review (football-product-expert)

**For:** every coach using the board, on a laptop, on a tablet pitch-side, and new coaches opening the examples.

**Would I use it on Tuesday night?** Yes, and E-01 matters most. Before, pressing Play and then nudging a player in Set up changed the wrong frame without telling me. That's the kind of bug that makes a coach stop trusting the tool. The examples now show the real coaching point: fix a defender, then release the free man round him.

| Area | Verdict |
|---|---|
| Coach workflow | PASS. Set up always means the start. Share has the link where coaches look for it. |
| Football correctness | PASS. The examples have no players inside each other and no passes through a defender. The counter shows fix → release → run beyond. |
| Ease of use | PASS. The draft offer no longer covers the drill, and disabled items say why. |
| Works during training (tablet) | PASS for the header and the hint. NEEDS WORK, later: a true portrait layout for upright tablets is a bigger piece (the board is landscape). For now the coach is told to turn the tablet sideways. |
| Animation | PASS. The same picture in 2D, 3D, video and Watch, with the 3D camera on the practice. |

**Solves the stated problems:** YES for E-01, E-02, E-03, E-05 to E-09. PARTLY for E-04: the header is fixed, and the pitch on an upright tablet is a hint, not a new layout.

**Verdict:** ship once your Playwright run is green. There are no Critical or Important findings left open.
