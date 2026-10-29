# Deploy runbook — 28 Oct 2026 (API + web, migrations 61, 62, 63 and 64)

Ships everything not yet committed on 28 Oct: the team set-up and the 27 Oct product-review fixes
("Part 2" of `Deploy_Runbook_2026-10-27.md`) plus the 28 Oct changes below.
**If the 27 Oct deploy (old AI removal, flanks, video cap…) is not live yet, it rides along** —
it is already in the last commits; just do the steps below.

**Migrations (applied by `deploy-api.sh` after its database backup):**
- `61_trial_feedback` — `free_usage.feedback_notes INT NOT NULL DEFAULT 0`
- `62_season_team_days` — `season_plans.team_days VARCHAR(20) NULL`
- `63_finance` — new tables `finance_transactions`, `finance_expenses` (Admin → Finance)
- `64_crm_pipeline` — `contact_messages` gets `stage`, `stage_changed_at`, `follow_up_at`,
  `deal_value_pence`, `lost_reason` (+ indexes); replied leads start at stage `contacted`;
  new table `lead_activities`

All add columns (with defaults) or new tables; old code ignores them.

## Admin → Finance and the CRM pipeline (owner-only)
- **Finance** (new tab): Profit & loss by month in **INR, cash basis**; Payments (every Stripe
  charge, refund and fee, with the INR that settled and Stripe's fee); Expenses (categories,
  suppliers, monthly/yearly repeats; a non-INR bill asks for the rupees that left the account).
  **Sync with Stripe** imports balance transactions — safe to press again.
  **Stripe key:** if `STRIPE_SECRET_KEY` is a *restricted* key, give it **Balance → Read**
  (balance transactions) and **Charges & refunds → Read**, or Sync returns an error.
- **Leads** gets stages (New → Contacted → Demo → Trial → Won / Lost), follow-up dates
  ("Follow-ups due" chip and Overview card), deal value, why-lost, the account a lead became
  (Paying / On trial / Free), and a timeline with notes ("Timeline & notes…" in the row menu).
  Replying to a new lead moves it to Contacted.

## Record yourself explaining (Pro, 28 Oct) — no migration
- API: new capability `live_record` in `src/lib/capabilities.ts` (Pro and Club; not Basic, not the trial).
- Web: **Record** button in the editor's top bar (webcam icon with a red dot, beside Share; marked Pro for others). Camera bubble (corner, size) or voice only, spotlight
  pointer, title card, pause/resume, 10-minute limit, preview, download. Made and kept in the
  browser: nothing is uploaded, no server cost. MP4 (H.264) in Chrome/Edge/Safari; WebM in Firefox.
- Brief: `tacticoach-frontend/docs/briefs/2026-10-28-record-yourself.md`.

## What changed on 28 Oct (web only)
- **Top bar (NAV-ALL):** every menu item stays visible — smaller labels, then icons with tooltips;
  ☰ only on phones or when even icons don't fit.
- **Board name (NAME-IN-SAVE):** the name box left the top bar. The first save asks for the name;
  the tag icon beside Share renames a saved board (and saves it).
- **2D video is 16:9 (VIDEO-16x9):** since the pitch-first layout the board takes the canvas's
  wide shape (~2.1:1 on a laptop) and the video did too, so players showed dark bars ("cut").
  Landscape boards now download as 16:9 (4K = 3840 × 2160) with a little grass round the
  touchlines and the turf carried to the frame edge; logo and coach credit in the frame corners.
  Portrait boards keep their shape; social clips unchanged.
- **Pitch size (PITCH-MAX):** 50–100 %, never bigger; old boards above 100 % open at 100 %.
- **Session plans (PLAN-MORE / PLAN-REVIEW / YOUNGEST):** 6 new themes (Attacking wide, One-twos
  and overlaps, Receive and turn, Switch the play, Run with the ball, Defend as a unit); 3v3 and
  4v4 plans and first sessions (no keeper, ~45 min); fixes to Passing, Finishing, Pressing and
  Playing out numbers and wording.
- **Editor end-to-end fixes (E2E-28OCT):** a pass, run or dribble can start on a player or the
  ball again (the drag used to pick the player up instead); opening a ready-made practice as a new
  board clears the old `?id=` so Save never overwrites the board you came from; the save dialog
  scrolls on short screens. 13 outdated mocked e2e specs brought up to date (no product change).
- **Ready-made practices (DRILLS-MORE):** 10 new — throw-in, defending a free kick, kick-off,
  shot-stopping, crosses (GK), lay-off and finish, 4v3 final third, one-two, 3v2 recovery, 1v1 defending.

## 0. On your Mac: commit and push both repos
```bash
cd ~/Desktop/Vinod/projects/tacticoach-api
git add -A && git commit -m "Trial feedback notes (61), season team days (62), Admin Finance: Stripe ledger, expenses, P&L (63), CRM pipeline (64), live_record capability, 28 Oct runbook" && git push
cd ~/Desktop/Vinod/projects/tacticoach-frontend
git add -A && git commit -m "Team set-up; review fixes; nav keeps every item; board name in save dialog; pitch max 100%; 6 new session themes + 3v3/4v4; 10 new ready-made practices; Admin Finance + CRM pipeline; Record yourself explaining (Pro)" && git push
```

## 1. Server (tmux)
```bash
cd /var/www/html/tacticoach-backend && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
#   expect: backup OK → "4 migrations applied" (61–64) → build → pm2 restart → health OK
curl -s localhost:3001/health
cd /var/www/html/tacticoach-frontend && bash scripts/deploy-web.sh && sudo nginx -t && sudo systemctl reload nginx
```
If `migrate deploy` fails the script stops before restarting — the old build keeps serving. Paste the error.

## 2. Check on the live site (Cmd+Shift+R)
1. Laptop width: Dashboard, Board, Sessions, Season, Team, Library … all in the top bar, no ☰.
2. New coach → dashboard asks "Set up your team" → save → the one-line summary shows.
3. Board: no name box in the top bar; Save asks for the name; the library shows it.
4. Pitch → Size slider stops at 100 %.
5. Sessions → new → Session plans: 14 themes at 7v7; pick 3v3 → 10 themes, 45 min, mini goals.
6. Board → ⋯ → Ready-made practices: "Games for young players", the new set pieces and goalkeeping.
7. Run session → Daylight → white page. Sessions list → Copy → opens "… (copy)".
8. Admin → Finance → **Sync with Stripe** → Payments shows this month's charges; P&L fills in.
   Add an expense in USD → it asks for the INR amount. Add a monthly one → it appears each month.
9. Admin → Leads: stage chips with counts; open a lead → Timeline & notes → set a follow-up for
   today → "Follow-ups due · 1" and the Overview card shows it.
10. Pro account → **Record** in the top bar → allow camera and mic → the notice says it
    stays on the device → record 20 s, pause, stop → preview → Download video → the file plays
    (camera light off after Stop). A Basic account gets the Pro dialog instead.
11. Board → Share → Video on a laptop: the file is 16:9, fills the player with no bars, corner flags not on the edge.
12. Board → Pass tool → press on a player and drag → the arrow starts at the player, who stays put.
13. Sentry: no new errors in 15 minutes.

## Rollback
Code can be rolled back on its own (`git checkout <previous>` + the deploy scripts); leave
migrations 61–64 in place — they only add columns and tables.
