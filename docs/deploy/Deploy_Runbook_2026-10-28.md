# Deploy runbook — 28 Oct 2026 (API + web, migrations 61 and 62)

Ships everything not yet committed on 28 Oct: the team set-up and the 27 Oct product-review fixes
("Part 2" of `Deploy_Runbook_2026-10-27.md`) plus the 28 Oct changes below.
**If the 27 Oct deploy (old AI removal, flanks, video cap…) is not live yet, it rides along** —
it is already in the last commits; just do the steps below.

**Migrations (applied by `deploy-api.sh` after its database backup):**
- `61_trial_feedback` — `free_usage.feedback_notes INT NOT NULL DEFAULT 0`
- `62_season_team_days` — `season_plans.team_days VARCHAR(20) NULL`

Both only add a column with a default; old code ignores them.

## What changed on 28 Oct (web only)
- **Top bar (NAV-ALL):** every menu item stays visible — smaller labels, then icons with tooltips;
  ☰ only on phones or when even icons don't fit.
- **Board name (NAME-IN-SAVE):** the name box left the top bar. The first save asks for the name;
  the tag icon beside Share renames a saved board (and saves it).
- **Pitch size (PITCH-MAX):** 50–100 %, never bigger; old boards above 100 % open at 100 %.
- **Session plans (PLAN-MORE / PLAN-REVIEW / YOUNGEST):** 6 new themes (Attacking wide, One-twos
  and overlaps, Receive and turn, Switch the play, Run with the ball, Defend as a unit); 3v3 and
  4v4 plans and first sessions (no keeper, ~45 min); fixes to Passing, Finishing, Pressing and
  Playing out numbers and wording.
- **Ready-made practices (DRILLS-MORE):** 10 new — throw-in, defending a free kick, kick-off,
  shot-stopping, crosses (GK), lay-off and finish, 4v3 final third, one-two, 3v2 recovery, 1v1 defending.

## 0. On your Mac: commit and push both repos
```bash
cd ~/Desktop/Vinod/projects/tacticoach-api
git add -A && git commit -m "Trial feedback notes (mig 61), season team days (mig 62), 28 Oct runbook" && git push
cd ~/Desktop/Vinod/projects/tacticoach-frontend
git add -A && git commit -m "Team set-up; review fixes; nav keeps every item; board name in save dialog; pitch max 100%; 6 new session themes + 3v3/4v4; 10 new ready-made practices" && git push
```

## 1. Server (tmux)
```bash
cd /var/www/html/tacticoach-backend && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
#   expect: backup OK → "2 migrations applied" (61, 62) → build → pm2 restart → health OK
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
8. Sentry: no new errors in 15 minutes.

## Rollback
Code can be rolled back on its own (`git checkout <previous>` + the deploy scripts); leave
migrations 61 and 62 in place — they only add columns.
