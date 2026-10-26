# Deploy runbook — 26 Oct 2026 (web only)

**Web only.** The API has nothing new since the last deploy except a runbook line, so no
API deploy, no migration, no restart. If the **24 Oct deploy was not done**, do
`Deploy_Runbook_2026-10-24.md` instead — it deploys the API and the web, and the web part
picks up everything below as well.

**What's in it (coach-facing)**
- **Help card crash on phones fixed (Sentry TACTICOACH-WEB-H):** with an ⓘ help card open,
  opening or closing the phone keyboard (a window resize) threw
  "Failed to execute 'contains' on 'Node'". Seen once on /sessions/new, Edge on Android.
  Fix in `src/help/HelpTip.tsx`, test `tests/unit/helpTipResize.test.tsx`.
- **Public site v3:** clean light page, Inter only, real screenshots of the board, dark top
  bar with the logo, dark footer, 7 languages. `tacticoach-frontend/docs/briefs/2026-10-26-site-v3.md`.
  **Only visible if the server's `.env` has `VITE_PUBLIC_SITE=true`.** Without it the site stays
  hidden (visitors go to /login) — the deploy prints `website: HIDDEN` or `website: PUBLIC`.
- **Signed-out top bar** (also on /login, /contact, /early-access): Product, For players,
  Pricing, FAQ, Contact. Books and Blog moved to the site footer.

**Code**
- **Web** `main` @ `552c34b` + one small test-only commit (step 0). Nothing to install that
  isn't already in `package.json`; three new images in `src/assets/site/`.
- **API** unchanged (`1d5af13` is a docs line — pulling it is optional).

**Checked before deploy (26 Oct, sandbox)**
- Web full unit suite: **218 files / 3,020 tests passed** in 3 batches (the long
  `realism/sweep` skipped — nothing touched player movement). Two old tests described what v3
  removed on purpose (Books in the signed-out bar; the sample "featured coach" on the landing
  page) and were updated to the new behaviour — that is the test-only commit in step 0.
- Typecheck and lint clean. Production build with `VITE_PUBLIC_SITE=true`: 42 pages
  pre-rendered, `/`, `/de`, `/es`, `/fr`, `/it`, `/pt`, `/tr`, `/en-us` each in their language.
- Mocked e2e `app.spec` landing test passes. The live Playwright suite runs on the Mac only.

**Time:** about 10 minutes.

---

## 0. On your Mac: commit the two test updates and push

```bash
cd ~/Desktop/Vinod/projects/tacticoach-frontend
git add tests/unit/bookTour.test.ts tests/unit/e2eFixes20261023.test.ts
git commit -m "Tests follow site v3 (Books in footer, no sample coach). Fixes TACTICOACH-WEB-H"
git push
git status -sb && git log --oneline -1      # ## main...origin/main, no [ahead N]
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

## 3. Web

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
2. **Sentry:** TACTICOACH-WEB-H gets no new events. If the commit is linked to the release it
   resolves itself; otherwise resolve it by hand after a day with no new events.
3. **Signed-out bar** on `/login`: dark, logo, Product · For players · Pricing · FAQ · Contact;
   each of the first four opens the site at that section (only when the site is public).
4. **If public:** `/` is the light page with the board screenshot; `/de` is German straight away
   (view source: `lang="de"`, "Einheit planen"); the three screenshots load
   (`/assets/board-2d-*.jpg`, about 90 KB); plan buttons go to `/early-access?plan=…`;
   on a phone the bar folds into ☰ and the pricing cards stack; footer links work.
5. **Sentry:** no new errors in the 15 minutes after.

## Rollback

| What | How |
|---|---|
| Web | `cd /var/www/html/tacticoach-frontend && git checkout <previous from the "code:" line> && bash scripts/deploy-web.sh && sudo systemctl reload nginx`, then `git checkout main` before the next deploy |
| Just hide the new site | remove `VITE_PUBLIC_SITE=true` from `.env` and run `bash scripts/deploy-web.sh` again |
