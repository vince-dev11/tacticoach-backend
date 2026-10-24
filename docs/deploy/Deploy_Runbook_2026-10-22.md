# Deploy runbook — 22 Oct 2026 (API + web)

Ships everything since the last deploy: Stripe and onboarding emails (20 Oct), coach articles (20 Oct), help topics and Ask switched **off** (21 Oct), drawings that stay across frames (21 Oct), Open day and Print the day, and the day-card fixes (22 Oct), and **sign-in tracking** in Admin → Users (23 Oct).

- **Coach-facing notes:** `TACTICAL_COACH/Release_Notes_2026-10-22.md`.
- **Detail per feature:**
  - `Deploy_Billing_Onboarding_Email_2026-10-20.md`
  - `Deploy_Coach_Articles_2026-10-20.md`
  - `Deploy_Ask_Assistant_Help_Topics_2026-10-21.md`

**Code**

- **API** `main` @ `9ba71de` + the 23 Oct sign-in commit. 4 new migrations: `55_coach_articles`, `56_billing_and_onboarding_email`, `57_assistant_questions`, `58_sign_in_tracking`.
- **Web** `main` @ `7f28e29` + the 23 Oct commit (sign-in badges in Admin, new social clip templates: `docs/briefs/2026-10-23-social-templates-v5.md`). New routes, so nginx needs a reload.

**Checked before deploy (22 Oct)**

- **API:** full suite **1,599 passed**; typecheck clean.
- **Web:** full unit suite passed in chunks. The one exception is the long `realism/sweep` animation test, which exceeds the sandbox time limit. It passed on 21 Oct, and nothing since touches player movement.
- **Web:** typecheck clean. The production build works and writes `help-knowledge/*.json`.

**Order:** push check → log in → pre-flight → API → web → nginx reload → checks. About 20–25 minutes.

---

## 0. On your Mac: make sure both repos are pushed

```bash
cd ~/Desktop/Vinod/projects/tacticoach-api      && git status -sb && git push
cd ~/Desktop/Vinod/projects/tacticoach-frontend && git status -sb && git push
```
The first line should read `## main...origin/main` with no `[ahead N]`. "Everything up-to-date" is fine.

## 1. Log in, in tmux

```bash
ssh -i ~/Downloads/tacticoach.co.uk.pem -o ServerAliveInterval=30 ubuntu@13.53.60.120
tmux new -s deploy            # "duplicate session" → tmux attach -t deploy
```
Don't press keys while a build runs. If the connection drops, reconnect and run `tmux attach -t deploy`.

## 2. Pre-flight (read-only)

```bash
df -h /                       # Avail over 1G
pm2 status                    # tacticoach-api: online
cd /var/www/html/tacticoach-backend
bash scripts/preflight-deploy.sh
```
- **Section 3 must be 0.** Otherwise run `npx prisma migrate resolve --rolled-back <name>` first.
- **Plans:** every row in the plans check must say `ok`, not `RE-SEED NEEDED`.

### New `.env` lines on the API

All are optional. The deploy works without them.

```bash
nano .env
```

| Line | Value now | Why |
|---|---|---|
| `ASSISTANT_ENABLED=` | **leave blank** | Ask stays off until you decide. |
| `BOOK_SALES=true` | `true` | Book checkout works once the Stripe keys are in. |
| `WELCOME_VIDEO_URL=` | the 60-second video link, or blank | Used in the "Personal welcome" message. |
| `EMAIL_WEBHOOK_TOKEN=` | blank until Brevo is set up | Bounce tracking. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | only when you go live | Without them, checkout says billing isn't configured. Nothing breaks. |

Stripe and Brevo set-up: `docs/setup/Email_And_Stripe_Setup_2026-10-20.md`.

## 3. API

```bash
cd /var/www/html/tacticoach-backend
echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
```
The script runs: backup → pull (`… → 9ba71de`) → install → generate → **migrate (55, 56, 57, 58)** → build → restart → smoke.

If a migration or the build fails, the old API keeps running. Don't restart it; paste the error.

Then check:
```bash
npx prisma migrate status            # "Database schema is up to date!"
pm2 logs tacticoach-api --lines 200 --nostream | grep -E "Uploads:|Error tracking:|Stripe|reminder"
curl -s localhost:3001/health         # {"status":"ok",...}
```

**About emails on first start:**
- Migration 56 marks coaches who were already invited as "already reminded", so the hourly reminder job does **not** send a wave of emails.
- Send reminders when you're ready, from **Admin → Users → Resend to everyone waiting**.

## 4. Web

```bash
cd /var/www/html/tacticoach-frontend
bash scripts/deploy-web.sh
```
Look for:
- `code: … → 7f28e29`
- `GA4: measurement ID baked in`
- `Done. Frontend at 7f28e29`

It **will** print the yellow reload line (new routes such as `/articles/mine`):
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Leave `VITE_ENABLE_ASK` unset in the web `.env`, so the Ask button stays hidden.

## 5. Check on the live site (hard-refresh with Cmd+Shift+R)

1. `curl -s https://tacticoach.co.uk/help-knowledge/en.json | head -c 120` returns JSON (Ask's knowledge, ready for later).
2. **Board:** in Movement, draw a zone on frame 1. It's still there on frames 2–3. Delete it on frame 3: it disappears from frame 3 on and is still on frames 1–2.
3. **Season:** open a day. You see every activity with ticks. Untick one and press **Print the day**: the PDF downloads without it.
4. **Day cards:** names have no "· Mon, …" on the end, and unrated sessions show "RPE ~5".
5. **Help:** `/help/team` and `/help/account` open.
6. **Profile → Your details → Plan & billing** shows your plan.
7. **Dashboard:** the "My articles" card opens `/articles/mine`.
8. **Admin → Blog:** the "Pending review" filter is there.
   - **Admin → Users:** each row says *signed in <date>* / *has signed in* / *never signed in*; invited people say *password set <date>* or *invited · password not set*. The **Signed in** and **Invitation** filters work. Sign in yourself and your row shows today.
9. **Brand fixes (23 Oct):** see `TACTICAL_COACH/03_Brand_and_Guides/brand/Brand_Review_2026-10-23.md`.
   - **Trial wording:** the page head, link previews and `llms.txt` say "14-day free trial, no card".
   - **Font:** the app shows Inter. In DevTools → Network, filter "woff2" and look for `inter-latin-400-normal`.
   - **Buttons** are the brand green `#00C985`.
   - **Re-share:** after deploying, re-share one link in WhatsApp or Facebook to refresh their cached preview.
   **Admin → Analytics → Health:** "Errors per day" and "Open issues" show Sentry data instead of "Sentry API failed (400)". Results are cached for 15 minutes.
   **Security fixes (23 Oct):** see `docs/security/Security_Review_2026-10-23.md`.
   - Book sales are recorded at the amount actually paid.
   - A duplicate book payment is refunded.
   - The subscription end date is read on both Stripe API versions.
   - `nodemailer` goes to 10.2.1. `deploy-api.sh` runs `npm install`, so it arrives with the deploy.
   - After the deploy, send one email (e.g. "Forgot password" for your own account) to confirm mail still goes out.
   **E2E fixes (23 Oct):**
   - A new board no longer overwrites an older unsaved draft.
   - No "Unsaved work" right after a Save.
   - Early access → "Player or parent" asks who is filling it in, and an under-18 gets no form.
   - Age groups read "U8–U9", "U10–U11" and so on.
   - Landing mock-ups say "Example page".
   - Admin → Users shows "no login (under 13)" (the API now sends `canLogin`; no migration).
   - List: `TACTICAL_COACH/E2E_Report_2026-10-23.md`.
   **3D and Stadium** open on the whole pitch, seen from behind the near goal at an angle; ⌂ returns there.
   **Social clip (V5):** in a board with movement, Share → Clip for social media. The dialog names the view you're in (2D, 3D or Stadium) and offers five looks — **Pitchside**, **Split**, **Corner**, **Playbook**, **Poster** — each in its own lettering (two new bundled fonts; in DevTools → Network look for `bebas-neue` and `dm-serif-display` woff2 when you open the dialog). Type a headline and a coaching point, tick "Use my kit colour" if you like, and export one story from 2D and one from 3D: the background is the view itself (your turf / the 3D ground), the pitch fills the middle, no words sit on it, and the "made with tacticoach" mark is centred under the banner. The locales carry the new copy; nothing in the API changed.
10. **Admin → Overview → Payments & email:** shows Stripe off/test/live and the sender.
11. **Sentry:** no new errors in the 15 minutes after the deploy.

## Rollback

| What | How |
|---|---|
| API code | `git checkout <previous from "code:" line>`, `npm install`, `npm run build`, `pm2 restart tacticoach-api` |
| Database | `deploy-api.sh` took a backup in step 1 (`~/…sql.gz`). Migrations 55–58 only **add** columns and tables, so older code runs against the new schema. Restoring the backup is only needed if data is damaged. |
| Web | `git checkout <previous>` then `bash scripts/deploy-web.sh`, then reload nginx |
| Ask | already off (`ASSISTANT_ENABLED` blank and `VITE_ENABLE_ASK` unset) |

## About migration 58 (sign-in tracking)

Sign-ins were never recorded before, so the migration fills in existing accounts **from evidence only**:

- **Has signed in:** the earliest of their sessions, boards, drill sheets and session plans. Nobody can make those without signing in.
- **Last sign-in:** left empty, because there is no honest source. Admin shows *has signed in* until they next sign in.
- **Password set from invite:** taken from the date their email was verified, for invited accounts only. An invited account can only become verified by opening a link we emailed.
