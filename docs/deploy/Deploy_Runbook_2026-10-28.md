# Deploy runbook — 28 Oct 2026 (API + web, migrations 61–66)

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

- `65_note_watch_answer` — `player_notes` gets `watched_at`, `answer` (JSON), `answered_at` (all nullable)
- `66_team_updates_opt_out` — `users.team_updates_opt_out_at DATETIME NULL` (BULK-MAIL)

All add columns (with defaults) or new tables; old code ignores them.

## The board teaches the player (29 Oct) — migration 65
Brief: `tacticoach-frontend/docs/briefs/2026-10-29-teach-players.md`.
- **Ground / Air** per frame on the timeline, also in 3D / Stadium.
- **Teach layer everywhere:** Show board, Run session, 3D/Stadium live and the 3D video stop at the question and dim to the spotlight; facing, marking and zone lines in 3D.
- **Board on a player note:** picker in the note sheet; the player watches privately at `/my-football/move/:noteId`, a parent at `/family/move/:noteId` (API: `GET/POST /api/feedback/my-notes/:id/move|answer`, `GET/POST /api/family/notes/:id/move|answer`). Note emails now link to the private page. Coach sees Watched / Answered.
- **Place the run:** the player answers the stop-and-think by dragging a ghost; the coach's run is drawn over it.
- **Player screens:** step mode, busy boards at half speed, question first, three stills; Loop in the editor; "Player's eyes" camera in the 3D player.
- **Role cards PDF (ROLE-PDF):** four cards to a page, never cut between pages; two of a kind say LEFT / RIGHT (and CENTRE for the middle of three).
- **Dropdowns and dialog buttons (SELECT-ARROW / BTN-PAIR):** one dropdown arrow everywhere with room round it; Print / Save PDF the same height.
- **Piece size on the attacking third (PIECE-SIZE):** the third's board is now 1331×720 (was 1000×541), so players and balls are the same size on screen as on every other pitch; saved boards are remapped on open.
- **TV camera (TV-SMOOTH / TV-STILL / LIVE-60):** the 3D / Stadium TV camera now holds still while the ball plays in the middle of the picture and pans once, gently, when the ball nears the edge (it used to chase the ball every frame, so the pitch never stopped moving); the camera and the stands move on every screen frame (they stepped every other frame — the shaking). The Watch window and share player step at 60 a second (the file stays 30 fps; its TV camera holds and pans the same way). Measured in Chrome: 60 fps, no dropped frames, two pans in a three-move example.
- **Social clip looks (SOCIAL-V6, 30 Oct):** Pitchside kept; Split, Corner, Playbook and Poster replaced by Broadcast, Headline, Editorial and Ticket (owner-approved designs in `TACTICAL_COACH/02_Marketing/Social_Templates_Proposal_2026-10-30/`). Same bands, same words, same kit-colour swap; the help topic lists the new names.
- `nginx/spa-routes.conf` regenerated for the two new routes — deploy-web picks it up.
- **WhatsApp number (WHATSAPP, owner 4 Nov, API + web, no migration):** an optional "WhatsApp number" on sign-up and on the early-access request — coaches and clubs only, never a player or parent; must carry the country code (`+44 7700 900000`), checked on both sides (`lib/whatsapp.ts`, `auth.schema.ts` PHONE_RE). Sign-up stores it in the existing `users.phone`; early access adds a "WhatsApp: …" line to the lead's message. Admin → Users shows it as a green tap-to-chat link (wa.me); nowhere else. 7 locales. Live check 19: sign-up as a coach → the field sits under Email, `07700…` is refused, `+44 7700 900000` is accepted → Admin → Users shows "WhatsApp +44 7700 900000" on the row.
- **Email everyone (BULK-MAIL, owner 4 Nov, API + web, migration 66):** Admin → Users → **Email everyone…** — pick *All coaches & clubs* / *Signed in at least once* / *Set up their password*, see the count, write subject + message (`{name}` = first name), confirm the number, get "Sent n of m · failed". One separate email per person (`kind: team_update` in the email log; 120 ms apart; 500 a go — press again for the rest), from `TEAM_MAIL_FROM`, with a one-click **opt out of team updates** link in every copy (`GET /api/account/team-updates/opt-out?u=&t=`, HMAC-signed, signed-out, answers a small page). Players and parents are never included; opted-out accounts are skipped and counted. Owner-only (`requireOwner`), 5 sends/hour. Use it for news and updates, not for account notices (those have their own emails and ignore the opt-out). Live check 20: Admin → Users → Email everyone → *Set up their password* → count shows → send to yourself first (make your own account match) → the mail arrives with "Hi <name>" and the opt-out line → tap it → the page says done → the count drops by one.
- **Referral programme put away (REFERRALS-HIDDEN, owner 3 Nov, API + web):** off by default on both sides — nothing to set on the server. Web: no "Invite coaches" card on Profile, no `/referrals` page (real 404), no footer link, help topic, Terms §4a or llms.txt line, and a `?ref=` code on sign-up / early access is ignored; the links to `/referrals` on `/collaborate` and `/collaborators` are gone too. API: `/api/referrals/lookup`, `/me`, `/agreement` and `/accept` answer `404 referrals_off`; a `referralCode` on register is dropped. **Kept:** referrals already recorded still earn their credit on the first invoice (promised under the Terms); Admin → Referrals (signatures, PDFs) stays; Collaborations untouched. To run it again: `REFERRALS_ENABLED=true` (API) **and** `VITE_ENABLE_REFERRALS=true` (web build). Live check 18: Profile shows four cards (no Invite coaches); `/referrals` is the not-found page; `/terms` has no §4a; `/collaborate` has no referral button; `GET /api/referrals/me` with a coach token → 404 `referrals_off`.
- **Sentry TACTICOACH-WEB-K / -N (STALE-BUILD-2, 3 Nov, web only):** "Cannot read properties of undefined (reading 'default')" on /login, once per deploy — the aftermath of the stale-build reload itself (a cancelled `vite:preloadError` makes Vite hand React.lazy an empty module while the page is already reloading). The boundary now knows a reload is in flight and reports nothing; a failure that comes back after the reload still reaches the crash screen. Resolve both in Sentry after deploy.
- **Sentry TACTICOACH-WEB-M (INJECTED-SCRIPT, 3 Nov, web only):** "Error: Ma" on /reset-password with every frame "inside" the HTML (lines that are `<meta>` tags) — a script injected by the browser or an add-on, not ours. `beforeSend` drops errors whose frames are all in the page document; anything with a frame from a real `.js` file is kept. Resolve in Sentry.
- **Admin → Referral terms → PDF (ADMIN-PDF-401, 3 Nov, web only):** the button was a plain link to the API, so the browser opened it with no sign-in token and the owner got `401 Invalid or expired token`. It now downloads the PDF with the token (`apiDownload` in `lib/api.ts`); an error shows on the page instead of a JSON screen. Live check 17: Admin → Referral terms → PDF on a signed coach → the file downloads.

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
#   expect: backup OK → "6 migrations applied" (61–66) → build → pm2 restart → health OK
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
13. Board → Movement → frame 1 **Ground**, frame 2 **Air** → 3D: the second pass rises, the first rolls.
14. Put a player in the spotlight with a question → Show board and 3D both stop on it.
15. Feedback → a note → **Watch the move** → pick a private board → send. Player account: My football →
    Watch the move → the question first → drag the ghost → Check → the coach's run appears.
    Coach: the note shows Watched · Answered. The board is still private in the Library.
16. Sentry: no new errors in 15 minutes.

## Rollback
Code can be rolled back on its own (`git checkout <previous>` + the deploy scripts); leave
migrations 61–66 in place — they only add columns and tables.
