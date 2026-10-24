# Deploy runbook — 24 Oct 2026 (API + web)

Ships everything since the last deploy. If the 22 Oct deploy was **not** done yet, this one covers it too (the steps are the same; the pre-flight tells you which migrations are pending).

**What's in it (coach-facing)**
- **Social clips V5:** Share → Clip for social media, five looks (Pitchside, Split, Corner, Playbook, Poster), background is the view, pitch fills the clip, kit-colour accent. `tacticoach-frontend/docs/briefs/2026-10-23-social-templates-v5.md`.
- **3D and Stadium** open on the whole pitch from behind the near goal; ⌂ returns there.
- **E2E fixes** (draft overwrite, early-access child data, age bands, "Example page" labels, Admin "no login (under 13)"): `TACTICAL_COACH/E2E_Report_2026-10-23.md`.
- **Brand fixes** (trial wording, Inter font bundled, brand green): `TACTICAL_COACH/03_Brand_and_Guides/brand/Brand_Review_2026-10-23.md`.
- **Security / payments fixes** (book sale recorded at the amount paid, duplicate payment refunded, subscription end date on both Stripe API versions, nodemailer 10.2.1): `docs/security/Security_Review_2026-10-23.md`.
- **Admin → Analytics:** Sentry panels work again (400 fixed); PageSpeed needs `PAGESPEED_API_KEY` (optional).
- Plus everything listed in `Deploy_Runbook_2026-10-22.md` if that deploy hasn't happened.

**Code**
- **API** `main` @ `e34eb07` (pushed). Migrations: none new since 58. If 55–58 are still pending on the server, `deploy-api.sh` applies them.
- **Web** `main` @ `e89b0d9` (pushed). New fonts and routes → nginx reload.

**Checked before deploy (24 Oct, sandbox)**
- API: full suite **91 files / 1,612 tests passed**; typecheck clean.
- Web: full unit suite **214 files / 2,988 tests passed** in 3 batches (the long `realism/sweep` skipped — nothing since touches player movement); typecheck clean; production build OK, `help-knowledge/*.json` written, the five social fonts in `dist/assets`.
- Web mocked e2e: `social-clip.spec` passes. **Known stale, not a blocker:** `tests/e2e/editor.spec.ts` and `editor-video.spec.ts` drive the old AI panel ("Generate animation", "Reel"), which has been off since AI was switched off, so 5 of their tests fail for that reason; to be rewritten against `window.tacticoach`. The live suite runs on the Mac only.
- Not run here: a real video download (needs a browser with an encoder) — check one after the deploy (step 5).

**Order:** push check → log in → pre-flight → API → web → nginx reload → checks. About 20–25 minutes.

---

## 0. On your Mac: both repos pushed

```bash
cd ~/Desktop/Vinod/projects/tacticoach-api      && git status -sb && git log --oneline -1
cd ~/Desktop/Vinod/projects/tacticoach-frontend && git status -sb && git log --oneline -1
```
Expect `## main...origin/main` with no `[ahead N]`, and `e34eb07` / `e89b0d9` (or later).

## 1. Log in, in tmux

```bash
ssh -i ~/Downloads/tacticoach.co.uk.pem -o ServerAliveInterval=30 ubuntu@13.53.60.120
tmux new -s deploy            # "duplicate session" → tmux attach -t deploy
```

## 2. Pre-flight (read-only)

```bash
df -h /                       # Avail over 1G
pm2 status                    # tacticoach-api: online
cd /var/www/html/tacticoach-backend
bash scripts/preflight-deploy.sh
```
- Section 3 must be 0; otherwise `npx prisma migrate resolve --rolled-back <name>` first.
- Plans: every row `ok`.
- `.env`: nothing new is required. Optional: `PAGESPEED_API_KEY=` (Admin → Analytics → Performance), and the 22 Oct lines if not set (`BOOK_SALES=true`, `WELCOME_VIDEO_URL=`, `EMAIL_WEBHOOK_TOKEN=`; leave `ASSISTANT_ENABLED=` blank).

## 3. API

```bash
cd /var/www/html/tacticoach-backend
echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
```
backup → pull (`… → e34eb07`) → install (brings nodemailer 10.2.1) → generate → migrate (55–58 if pending) → build → restart → smoke.

Then:
```bash
npx prisma migrate status            # "Database schema is up to date!"
pm2 logs tacticoach-api --lines 200 --nostream | grep -E "Uploads:|Error tracking:|Stripe|reminder|Error"
curl -s localhost:3001/health
```

## 4. Web

```bash
cd /var/www/html/tacticoach-frontend
bash scripts/deploy-web.sh
sudo nginx -t && sudo systemctl reload nginx
```
Look for `code: … → e89b0d9`, `GA4: measurement ID baked in`, `Done.`

## 5. Check on the live site (Cmd+Shift+R)

1. **Social clip:** open a board with movement → Share → Clip for social media. Five looks; type a headline and a coaching point; preview updates; export one story from 2D and one from 3D and play both on your phone. No words on the pitch; background is the view.
2. **Fonts:** DevTools → Network, filter `woff2`: `inter-latin-400`, and when the social dialog opens `bebas-neue`, `dm-serif-display`, `barlow-condensed`, `anton`.
3. **3D / Stadium:** opens on the whole pitch, low behind the near goal; ⌂ returns there.
4. **Video:** Share → Video on the same board downloads an MP4 that plays in QuickTime and on a phone.
5. **Board draft:** new board → place a player → open another board → the first one's draft is still offered; Save → no "Unsaved work".
6. **Early access → Player or parent:** asks who is filling it in; an under-18 gets no form.
7. **Admin → Users:** "no login (under 13)" badge; **Admin → Analytics → Health:** Sentry panels show data.
8. **Admin → Overview → Payments & email:** Stripe off/test/live and the sender.
9. Send one email (Forgot password on your own account) — nodemailer changed.
10. **Sentry:** no new errors in the 15 minutes after.

## Rollback

| What | How |
|---|---|
| API code | `git checkout <previous from "code:" line>`, `npm install`, `npm run build`, `pm2 restart tacticoach-api` |
| Database | the backup from step 3; migrations 55–58 only add columns/tables, so older code runs on the new schema |
| Web | `git checkout <previous>` then `bash scripts/deploy-web.sh`, reload nginx |
