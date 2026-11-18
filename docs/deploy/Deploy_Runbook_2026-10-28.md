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
- **Hide names (NAMES-SWITCH, 16 Nov, web only):** with a squad, a **Hide names / Show names** switch on the My squad shelf (Players toolbox). Hides the names on the board, in 3D/Stadium and in every video and picture. Live check 21: put squad players on a board → Hide names → the names go in 2D and 3D → Show names brings them back.
- **Record yourself — tall reel (RECORD-STACKED, owner 16 Nov, web only):** Record → Layout → **Tall reel** (9:16): headline / video band / board. Band = my camera, a video from my device, or none. The chosen video is read on the device, never uploaded, and recorded **without its sound** (voice only); it loops, with Pause video / Restart video in the recording bar; Start waits for the "everyone in this video has agreed" tick. Laptop and tablet only for now; Pro/Club as before. Brief: `tacticoach-frontend/docs/briefs/2026-11-16-record-stacked.md`. Live check 22 (Pro, Chrome on a laptop): Record → Tall reel → A video from my device → pick a phone clip → tick the box → Start → talk, press play on the board, Pause/Restart video → Stop → the preview is tall, only your voice is heard → Download → it plays on a phone. **Then try the same file flow on an iPad** — that is the test that decides when phones get it.
- **Tall reel: grass to the edges, board above or under (GRASS-FILL / BOARD-PLACE, owner 17 Nov, web only):** in the tall reel the 2D board's own striped turf now runs to the edges of its band (it was a flat green bar above and below a wide pitch), and a new **Board: Under the video / Above the video** choice swaps the two bands (the headline stays on top). Add to live check 22: choose Above the video → the preview and the file show the board over the video, with stripes all the way.
- **Recording opened on a black band (BLACK-START, owner 17 Nov, web only):** the recorder started before its copy of the camera (or a rewound clip) had a picture, so the first moments of the file showed a black video band (in the corner layout: no face). Recording now waits for the first picture (at most 2.5 s). Live check 22: open the downloaded file — the camera is there at 0:00.
- **Cleared board came back / cleared frame remembered things (DRAFT-CLEARED / FRAME-CLEARED, owner 17 Nov, web only):** Clear board left the draft from before the clear in the browser, so the next visit offered the cleared board back as "Unsaved work found" — an emptied board now removes its own draft (a saved board still loading keeps its draft; Undo restores and re-saves). Clear board also drops who-marks-whom. Clearing a frame's movement now also drops that frame's pass type (Ground/Air) and run timing; the note and the question stay. Live check 23: draw a board → Clear board → refresh → no "Unsaved work found". Frame 1: set a pass to Air → clear the frame → draw a new pass → it is on the ground.
- **Public by default (PUBLIC-DEFAULT, owner's decision 17 Nov, API + web, no migration):** a NEW board is public (community library, coach page, share link) with the names as drawn unless the coach unticks **Public — in the community library** in the save dialog (now ticked, and its hint says names will be seen); a NEW drill sheet starts **Shared** (its pictures are still drawn without squad names). `POST /canvas/boards` and `POST /drill-sheets` publish unless `published: false`. Existing boards and sheets are not changed; copies of a sheet still start private. Deploy order does not matter: the old web build still sends the coach's (unticked) choice, so nothing goes public unseen in between. Live check 24: save a new board → the box is ticked → it appears in the community library; untick on another → it does not. New drill sheet → Shared is selected.
- **Hide all player names (NAMES-ALL, owner 17 Nov, API + web, no migration):** the Hide names switch on the Players shelf now hides EVERY player's name (home, away, neutral) and shows whenever there is a squad or a name on the board (the editor only — a tick in the save dialog was built and removed the same day at the owner's word). Hidden names are also taken out of the data the API serves to other coaches (`lib/board-names.ts`, `GET /canvas/boards/:id` for a non-owner) — hidden on screen was not enough on a public board. The owner's own copy keeps them; Show names brings them back. (The public share link already served boards without any names.) Live check 25: board with named players → Players → Hide names → Save → from a second coach account open it in the community library → no names, on screen or when copied.
- **The board on a phone (PHONE-LANDSCAPE, owner 17 Nov, web only):** a phone held upright is asked to turn; on its side the full board opens in a compact layout (slimmer bars, toolbox as a slide-over, no helper cards on the pitch). Tablets and laptops unchanged. Live check 26 — **on two real phones (one Android, one iPhone)**: open Board upright → "Turn your phone sideways" → turn → the board; Players → + Add → drag the player with a finger; Movement → drag a run → play; 3D; Save. Note anything too small to tap.
- **Install TactiCoach (INSTALL, owner 17 Nov, web only):** the dashboard offers to install — home screen on a phone, its own window on a computer (then pin it to the taskbar or Dock). Manifest completed; no service worker on purpose. nginx must serve `/favicon/site.webmanifest` (it is a static file in `dist`; check `curl -sI https://tacticoach.co.uk/favicon/site.webmanifest` is 200). Live check 27: Chrome on a computer → dashboard → Install → the app opens in its own window → pin it; Chrome on Android → Install → icon on the home screen, opens full screen; iPhone Safari → the card shows the Share steps → Add to Home Screen → opens full screen. After a later deploy, open the installed app and confirm it shows the new build.
- **Tablet and phone layout (RESPONSIVE-17NOV, owner 17 Nov, web only):** the 18 findings of the tablet-and-phone test report, fixed in each page's own stylesheet — the New session dialog no longer wider than a phone; drill-sheet buttons wrap on a tablet; Show board fits a phone on its side; session-builder header buttons on one scrolling row; Admin tabs scroll with a fade; Library tabs on one row (number tiles hidden on phones); Dashboard as two-across tiles on a phone and five across on a tablet held sideways; Team explainers as short links; Run session pills on one line; Books filters and Help sections as scrolling rows; ⓘ buttons and Library pills finger-sized on touch. Guard: `tests/unit/responsive17Nov.test.ts`. Not done: one page style across the product (a design decision). Live check 28 — on a real phone and a real tablet: Sessions → New session (Copy and × visible); a drill sheet (PDF and Kids' cards reachable); Show board with the phone on its side (play bar visible); Library; Dashboard.
- **Broadcast look (BROADCAST-LOOK, owner 18 Nov, web only, no migration):** Pitch panel → **Board look: Classic · Broadcast**. Classic is unchanged and the default; Broadcast draws the 2D board with lighter cross-mown turf, finer lines and names on white labels, and the downloaded 2D video gets a soft dark edge. Saved with the board; the coach's own grass settings are never changed. Not in 3D/Stadium, library thumbnails or the share page. Live check 29: a board with named players → Pitch → Broadcast → the board changes → Classic → exactly as before → Broadcast → Save → reopen (still Broadcast) → Share → Video → the file shows the look with a darker edge.
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
