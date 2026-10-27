# Deploy runbook — 26 Oct 2026 (API + web)

**API + web, TWO migrations (59, 60).** 8v8 as a coaching/book format, and the coach's country:
migration `59_coaching_country` adds two nullable columns (`users.coach_country`,
`clubs.country`); `deploy-api.sh` applies it. Additive only — the old code runs on the new schema. If the **24 Oct deploy was not done**, do
`Deploy_Runbook_2026-10-24.md` instead — it deploys the API and the web, and the web part
picks up everything below as well.

**What's in it (coach-facing)**
- **Help card crash on phones fixed (Sentry TACTICOACH-WEB-H):** with an ⓘ help card open,
  opening or closing the phone keyboard (a window resize) threw
  "Failed to execute 'contains' on 'Node'". Seen once on /sessions/new, Edge on Android.
  Fix in `src/help/HelpTip.tsx`, test `tests/unit/helpTipResize.test.tsx`.
- **Sentry noise filter (TACTICOACH-WEB-J):** Instagram's in-app browser injects a script that
  throws `window._META.IABInnerFrame` (seen once on /early-access, iPhone). Not our code; the web
  Sentry setup now ignores it (`src/lib/monitoring.ts`, test `tests/unit/sentryInAppBrowser.test.ts`).
- **Session builder practice details tidied (SESSION-UI, 27 Oct):** the fields sit in four groups
  (Set-up · For the players · What to look for · Make it easier or harder), two columns when
  there's room, and every box grows with its text, so nothing is cut off. Layout only, no data change.
  Test `tests/unit/sessionDetailLayout.test.tsx`.
- **Public site v3:** clean light page, Inter only, real screenshots of the board, dark top
  bar with the logo, dark footer, 7 languages. `tacticoach-frontend/docs/briefs/2026-10-26-site-v3.md`.
  **Only visible if the server's `.env` has `VITE_PUBLIC_SITE=true`.** Without it the site stays
  hidden (visitors go to /login) — the deploy prints `website: HIDDEN` or `website: PUBLIC`.
- **8-a-side in the coaching profile (FORMAT-8V8):** the board has drawn 8v8 since 5 Oct, but
  Profile only offered 5/7/9/11-a-side. Now 8-a-side is there with the board's three 8v8
  formations (3-3-1, 3-2-2, 2-3-2), the API accepts it, and books can be tagged and filtered
  8v8. Tests: `tests/unit/format8v8.test.ts` (web), `tests/format-8v8.test.ts` (API).
- **Country you coach in (COACH-COUNTRY):** Profile → Your details → **Your team** now shows
  Country, Age group and Format to every coach (they had been hidden with the AI). The country
  only changes suggestions: age names (Sub-11 for Brazil/Portugal, JO11 for the Netherlands)
  and a format hint from the board's own country presets (England, USA, Germany, Netherlands
  for now; other countries get no hint rather than England's). A club owner sets the club's
  country on /club; their coaches start from it and can set their own.
  `tacticoach-frontend/docs/briefs/2026-10-26-coaching-country.md`.
- **Helping kids understand (KIDS, 26 Oct):** `tacticoach-frontend/docs/briefs/2026-10-26-kids-understand.md`.
  1. Main message for players (board Practice card / drill sheet / session exercise) and the sheet's
     questions shown big on Run session and Show board; the video uses the message where a frame has no note.
  2. **Parents' preview** in the session builder: a private link (aim, practices moving, a question for
     the way), copy/WhatsApp, switch off. Page `/share/session/:token` — no names, no notes.
  3. **Short clip** in the board's Share menu (frames from–to, normal or half speed).
  4–5. **Kids' cards** on the drill sheet: kids' card (picture, big message, picture cues, three
     challenges) and question cards (+ score-yourself card), PDF or print.
  6. **Home challenge** on a player's feedback note — shown to the player, on Family and in the email.
  7. **Role cards** in the board's Share menu: one card per position for 7v7–11v11, plain words, editable.
  Migration **60_kids_understand**: `training_sessions.preview_token` (unique) + `preview_question`,
  `player_notes.challenge` — all nullable, additive.
- **Signed-out top bar** (also on /login, /contact, /early-access): Product, For players,
  Pricing, FAQ, Contact. Books and Blog moved to the site footer.

**Code**
- **Web** `main` @ `552c34b` + one small test-only commit (step 0). Nothing to install that
  isn't already in `package.json`; three new images in `src/assets/site/`.
- **API** `main` + today's commit (step 0). Migration **59** (additive).

**Checked before deploy (26 Oct, sandbox)**
- After the country work (26 Oct, later): web full unit suite **220 files / 3,042 tests**, API
  full suite **94 files / 1,627 tests**, typecheck both, Profile checked in Chromium.
- Web full unit suite (earlier): **218 files / 3,020 tests passed** in 3 batches (the long
  `realism/sweep` skipped — nothing touched player movement). Two old tests described what v3
  removed on purpose (Books in the signed-out bar; the sample "featured coach" on the landing
  page) and were updated to the new behaviour — that is the test-only commit in step 0.
- Typecheck and lint clean. Production build with `VITE_PUBLIC_SITE=true`: 42 pages
  pre-rendered, `/`, `/de`, `/es`, `/fr`, `/it`, `/pt`, `/tr`, `/en-us` each in their language.
- Mocked e2e `app.spec` landing test passes. The live Playwright suite runs on the Mac only.

**Time:** about 25 minutes.

---

## 0. On your Mac: commit and push both repos

```bash
cd ~/Desktop/Vinod/projects/tacticoach-api
git add -A && git commit -m "Coach country (59), kids features (60: parents preview, home challenge), 8v8; 26 Oct runbook" && git push

cd ~/Desktop/Vinod/projects/tacticoach-frontend
git add -A && git commit -m "Helping kids understand (7 features); country you coach in; 8v8; tests follow site v3. Fixes TACTICOACH-WEB-H. Fixes TACTICOACH-WEB-J" && git push
git status -sb                               # both: ## main...origin/main, no [ahead N]
```

## 1. Log in, in tmux

```bash
ssh -i ~/Downloads/tacticoach.co.uk.pem -o ServerAliveInterval=30 ubuntu@13.53.60.120
tmux new -s deploy            # "duplicate session" → tmux attach -t deploy
```

## 2. Pre-flight (read-only)

```bash
df -h /                                     # Avail over 1G
cd /var/www/html/tacticoach-frontend
git status --short                          # must be empty (nothing edited on the box)
grep -E '^VITE_(PUBLIC_SITE|API_URL|SITE_URL)=' .env
```
- `VITE_API_URL` must be the public API URL.
- **Decide now** whether the new site goes public. To show it: set `VITE_PUBLIC_SITE=true` in
  `.env` (`nano .env`). To keep it hidden: leave it unset — the app and the Sentry fix still
  deploy, and the site goes public later by setting the line and running step 3 again.

## 3. API (first — the web's new 8v8 choice needs it)

```bash
cd /var/www/html/tacticoach-backend
echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
npx prisma migrate status            # "Database schema is up to date!" — 59_coaching_country and 60_kids_understand applied
curl -s localhost:3001/health
```

## 3b. Web

```bash
cd /var/www/html/tacticoach-frontend
bash scripts/deploy-web.sh
sudo nginx -t && sudo systemctl reload nginx
```
Look for `code: … → <your new commit>`, `website: PUBLIC` (or `HIDDEN`, as you chose), and
`Done.` If the build fails the script puts the previous site back by itself.

## 4. Check on the live site (Cmd+Shift+R)

1. **Sign in** as a coach → open **Sessions → New session** on your phone, tap any ⓘ, then tap a
   text field so the keyboard opens and closes. The card stays, nothing breaks.
2. **Profile → coaching → Format your team plays:** 8-a-side is between 7 and 9; choose it,
   Save, reload — it stays.
   **Your team:** set Country = Netherlands, Age group = JO10–JO11 → the hint reads
   "Netherlands · KNVB: JO10: 6v6 · JO11: 8-a-side." with **Use 8-a-side**; Country = Brazil →
   ages read Sub-…, and the hint says we don't have Brazil's formats yet. Save, reload — it stays.
   **Kids:** on a drill sheet type a main message and two questions → add the sheet to a session →
   Run session shows "Tell them" and "Ask them". Session builder → **Parents' preview** → Create link →
   open it on your phone (no names, practices moving) → Switch link off → the page says it isn't available.
   Drill sheet → **Kids' cards** → save both PDFs and open them. Board → Share → **Short clip** (2 frames,
   half speed) and **Role cards** (7v7) → open the files. Feedback: add a home challenge → send → it shows
   on the player's page and in the email.
   **/club as the club owner:** set the country; sign in as one of its coaches → Profile shows
   "Your club's: …".
3. **Sentry:** TACTICOACH-WEB-H gets no new events. If the commit is linked to the release it
   resolves itself; otherwise resolve it by hand after a day with no new events.
4. **Signed-out bar** on `/login`: dark, logo, Product · For players · Pricing · FAQ · Contact;
   each of the first four opens the site at that section (only when the site is public).
5. **If public:** `/` is the light page with the board screenshot; `/de` is German straight away
   (view source: `lang="de"`, "Einheit planen"); the three screenshots load
   (`/assets/board-2d-*.jpg`, about 90 KB); plan buttons go to `/early-access?plan=…`;
   on a phone the bar folds into ☰ and the pricing cards stack; footer links work.
6. **Sentry:** no new errors in the 15 minutes after.

## Rollback

| What | How |
|---|---|
| API | `git checkout <previous from the "code:" line>`, `npm install`, `npm run build`, `pm2 restart tacticoach-api` — migrations 59 and 60 only add nullable columns (and one unique index on a nullable column), leave them in place |
| Web | `cd /var/www/html/tacticoach-frontend && git checkout <previous from the "code:" line> && bash scripts/deploy-web.sh && sudo systemctl reload nginx`, then `git checkout main` before the next deploy |
| Just hide the new site | remove `VITE_PUBLIC_SITE=true` from `.env` and run `bash scripts/deploy-web.sh` again |
