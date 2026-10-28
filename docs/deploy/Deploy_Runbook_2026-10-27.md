# Deploy runbook — 27 Oct 2026 (API + web)

**API + web, NO migration.** Removes the old AI, fixes the template flanks, caps 2D video
at 3 minutes, two phone fixes, the session builder's practice details layout, and Node 24 in CI.
**If the 26 Oct deploy was not done, do `Deploy_Runbook_2026-10-26.md` first** — it carries
migrations 59 and 60. This one adds nothing to the database.

**What's in it**
- **Old AI removed (AI-REMOVE, owner's decision: clean rebuild).**
  - API: `src/modules/ai`, `evals/eval-ai.ts`, `lib/credits.ts`, the `npm run eval` script and the
    `/api/canvas/ai-layout`, `ai-animation`, `ai-correction`, `ai-credits` and `reel-copy` routes
    are gone (404 now).
  - Kept: the coach context moved to `src/lib/coachContext.ts` (the profile still validates
    against it); the `ai_usage` and `ai_corrections` tables (data, no code); the `ai` capability
    in `capabilities.ts`; `config/gemini.ts` (the Ask assistant uses it).
  - Web: the AI panel, the Reel maker, `aiDiff`, the AI calls in `editor/api.ts`, `AI_ENABLED` /
    `VITE_ENABLE_AI` and every branch behind them are gone. Nothing a coach sees changes, because
    the AI was off. One thing was visible before and is fixed now: the help centre listed a topic
    called "The AI assistant", and it is gone.
  - Terms and Privacy show exactly the text they showed before. Only the hidden AI branches were deleted.
  - **Server `.env`:** `VITE_ENABLE_AI` (web) does nothing now. You can delete the line.
    `GEMINI_*` (API) stays for Ask.
- **Template flanks (FLANKS).** Ten ready-made boards had full-backs and wide players on the
  wrong side (e.g. the 2 and 7 on the left in the 4-3-3 v 4-4-2). The six fully mirrored ones are
  reflected top-to-bottom, so the movement stays the same. The four mixed ones are relabelled:
  corner attacking, corner defending, high press and switch of play.
  Test `tests/unit/templateFlanks.test.ts`.
- **2D video cap (VIDEO-CAP).** Same 3-minute limit as 3D, checked before recording, with a
  translated message. Test `tests/unit/videoCap.test.ts`.
- **Phone fixes (PHONE).** The drill sheet's button row and the books shop's country/topic
  filters ran off the right edge at 375px; both wrap now.
  Test `tests/unit/phoneOverflow20261027.test.ts`.
- **Session builder practice details (SESSION-UI).** Four groups, boxes grow with their text.
- **Social post logo (LOGO).** Drill sheet → Share as a social post: the footer now shows the
  real "Made with tacticoach" logo (the drill sheet's dark stamp) instead of typed words.
- **Social clip = the view on screen (CAMERA-ANGLE / SAME-AS-SCREEN).** In 3D / Stadium a social
  clip (and a Story or Feed 3D video) films the pitch exactly as the view shows it — the coach's
  angle, the TV camera, or the view's opening camera when never moved — on every pitch (before, a
  half or third pitch was turned to the touchline and every clip used a different camera). A
  "Camera: As on screen · Low, along the pitch" choice sits in the dialog; a side-on angle on a full
  pitch shows a hint. Tests `socialCameraAngle.test.ts`, `tests/e2e/social-camera-angle.spec.ts`.
- **Node.** CI on Node 24; `engines: node >= 22` and `.nvmrc` = 24 in both repos.
- **Sentry noise filter (TACTICOACH-WEB-J)**, if it was not in the 26 Oct deploy.

**Checked before deploy (27 Oct, sandbox)**
- Web unit suite: 230 files, about 3,100 tests, all passing. API suite: 86 files, 1,429 tests,
  all passing (11 old AI test files removed with the code). Typecheck clean in both; lint clean on
  every changed web file.
- Mocked Playwright (`tests/e2e`):
  - **Before:** the suite ran with `VITE_ENABLE_AI=true`, so it tested a layout coaches never see.
    It now runs the real layout.
  - **Rewritten:** the editor, video and storyboard specs no longer use the AI panel. They now
    build the board through `window.tacticoach`, and they pass.
  - **Still failing: 22 specs.** All of them failed the same way on the code before this change
    (checked side by side). They were already out of date (admin, club, editor tools and others),
    and fixing them is a separate job.
- A phone-size check of 17 screens at 375px found the 2 overflows above, both fixed. The other
  15 had no sideways scroll.

## 0. On your Mac: commit and push both repos
```bash
cd ~/Desktop/Vinod/projects/tacticoach-api
git add -A && git commit -m "Remove the old AI module (coach context kept in lib/coachContext); Node 24 CI; 27 Oct runbook" && git push
cd ~/Desktop/Vinod/projects/tacticoach-frontend
git add -A && git commit -m "Remove old AI panel/reel/AI_ENABLED; template flanks; 2D video 3-min cap; phone overflow fixes; session details layout; Node 24 CI. Fixes TACTICOACH-WEB-J" && git push
```

## 1. Server (tmux, as in the 26 Oct runbook)
```bash
node -v                                   # v22 or v24 (24 recommended)
cd /var/www/html/tacticoach-backend && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
curl -s localhost:3001/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/api/canvas/ai-layout   # 404
cd /var/www/html/tacticoach-frontend && bash scripts/deploy-web.sh && sudo nginx -t && sudo systemctl reload nginx
```

## 2. Check on the live site (Cmd+Shift+R)
1. Editor: no AI panel, no Reel item in Share; the toolbox rail and the bottom strip as before.
2. Board → Templates → "4-3-3 v 4-4-2": the home 2 and 7 are at the **bottom** (the home right),
   the away 2 and 7 at the top. "Crossing": the 7 crosses from the bottom wing.
3. Help centre (Board): no "AI assistant" topic.
4. On a phone: Drill sheet → the buttons wrap under the title; Books → Country and Topic sit
   under their labels, nothing off the edge.
5. Sessions → open a practice: the four groups, nothing cut off.
   3D view on a half pitch → Share → Clip for social media: "As on screen" is on and the preview
   shows the pitch the way the view does (goal at the top); turn the camera and reopen — the clip
   follows; "Low, along the pitch" switches to the low angle.
   Drill sheet → Share as a social post: the logo sits bottom-right (Post, Carousel) or centred (Story).
6. Sentry: no new errors in 15 minutes.

## Part 2 — team set-up and the product-review fixes (27 Oct, later)

**Migrations (API first):** `npx prisma migrate deploy` applies
`61_trial_feedback` (free_usage.feedback_notes) and `62_season_team_days`
(season_plans.team_days). Both are additive with defaults; old code ignores them.

What changed (web unless noted):
- Set up your team card on the dashboard; new boards, sessions, sheets and seasons start from it; Team in the top bar.
- Trial includes 1 squad and 5 feedback notes (API: capabilities, plan-quota, feedback routes).
- Season: training days and "Add themes to the next weeks" (API: plans routes).
- Starter sessions save themselves and carry board pictures; 8v8 starter.
- Movement on Start positions offers "Go to frame 1" / "Make that a run"; tours no longer open by themselves.
- First save asks for the board's name; every profile formation is on the board (5v5 2-1-1/1-1-2, 7v7 3-2-1/2-1-2-1/3-3, 9v9 3-3-2/2-3-2-1/3-4-1, 11v11 4-1-4-1/3-4-3).
- Four games for U7–U11 in Ready-made practices, first for a U7–U11 team.
- Age boxes suggest the team bands; Books marks "Your team" on the matching age chip.
- Run session and Match Day: Daylight switch. Frame buttons have words. Sessions list: Copy.

Smoke test after deploy:
1. New coach → dashboard asks Set up your team → pick 7-a-side, U10–U11 → the line shows; Board opens on the 7v7 pitch.
2. Board → save → the dialog asks for a name; the library shows that name.
3. Formations (7v7) list 2-3-1, 3-2-1, 2-1-2-1, 3-3.
4. ⋯ → Ready-made practices → "Games for young players" first.
5. Sessions → Copy on a session → opens "… (copy)", undated.
6. Run session → Daylight → white page; reload → still white.
7. Books → "Your team" on U9–11.

## Rollback
Part 2 has two additive migrations: rolling the code back is safe without reverting them.
Either repo can be rolled back on its own: `git checkout <previous>` and run the
deploy script again (API: `npm install && npm run build && pm2 restart tacticoach-api`).
