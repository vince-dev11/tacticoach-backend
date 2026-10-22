# Deploy runbook — 16 Oct 2026

Both repos are committed and pushed (`main` = `origin/main`). This deploy ships everything since the last one:

- **API:** email problems (EMAIL-FAIL), Sentry filter for 4xx/validation errors, S3 uploads + `scripts/sync-uploads-to-s3.mjs`, dependency updates. **No new migrations** (latest is still `54_lead_times`).
- **Web:** pass timed into the run (MEET), the new real-player look, 3D surroundings (Training ground / Night / Studio), Admin "Can't be emailed" badge and filter, dependency updates, `/api` on the main domain.

Order: **pre-flight → copy existing uploads to S3 → API → web → checks.** About 20 minutes.

---

## 0. Log in, in tmux

```bash
ssh -i ~/Downloads/tacticoach.co.uk.pem -o ServerAliveInterval=30 ubuntu@13.53.60.120
tmux new -s deploy            # if it says "duplicate session": tmux attach -t deploy
```
Inside tmux a dropped connection doesn't stop anything; reconnect and `tmux attach -t deploy`. **Don't press keys while a build runs.**

## 1. Pre-flight (read-only)

```bash
df -h /                       # "Avail" must be over 1G (the dependency update downloads new packages)
free -m                       # Swap line should show ~1023 (or ~511)
node -v && npm -v
pm2 status                    # tacticoach-api: online

cd /var/www/html/tacticoach-backend
grep -oE '^(AWS_REGION|S3_BUCKET|SUPPORT_EMAIL|SENTRY_DSN|FRONTEND_URL)=.{0,24}' .env
grep -cE '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=.+' .env     # 2

cd /var/www/html/tacticoach-frontend
grep -oE '^VITE_(API_URL|SITE_URL|GA_MEASUREMENT_ID|POSTHOG_HOST)=.*' .env
grep -cE '^VITE_(SENTRY_DSN|POSTHOG_KEY)=.+' .env                 # 2
```

What you should see:

| Line | Must be |
|---|---|
| `AWS_REGION` | `eu-north-1` (not `eu-west-1`) |
| `S3_BUCKET` | `tacticoach-uploads` |
| `SUPPORT_EMAIL` | your inbox (`tacticoach.co.uk@gmail.com`), **not blank** |
| `FRONTEND_URL` | `https://tacticoach.co.uk` |
| `VITE_API_URL` | `https://tacticoach.co.uk` (the `/api` block in nginx is live) |
| `VITE_SITE_URL` | `https://tacticoach.co.uk` |

Fix anything that differs with `nano .env` before going on.

**If disk is under 1 GB:** grow the volume first (EC2 → Volumes → the server's volume → Modify → 20 GiB), then:
```bash
lsblk                                    # find the disk, e.g. nvme0n1 / nvme0n1p1
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1            # or: sudo resize2fs /dev/root
df -h /
```

## 2. Copy the existing uploads into S3 (before the API switches over)

The API reads from S3 as soon as it restarts with the AWS keys, so copy what is on disk first — same paths, so every board thumbnail, video and logo in the database keeps working.

```bash
cd /var/www/html/tacticoach-backend
git pull --ff-only                                  # brings the sync script
node scripts/sync-uploads-to-s3.mjs --dry-run       # lists the files
node scripts/sync-uploads-to-s3.mjs                 # copies them (safe to re-run)
```
It ends with `Copied N files (… MB)`. "No uploads folder" means there is nothing to copy — fine. An `AccessDenied` error means a key or the region is wrong in `.env`.

## 3. API

```bash
cd /var/www/html/tacticoach-backend
echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
```
Backup → pull (nothing new) → install (the updated packages) → migrations (none pending; the `echo y` answers the prompt) → build → restart → smoke test. It can sit on `tsc` for a few minutes.

Then check the boot lines:
```bash
pm2 logs tacticoach-api --lines 200 --nostream | grep -E "Uploads:|Error tracking:"
```
Expect `📦 Uploads: S3 → s3://tacticoach-uploads (eu-north-1)` and `🛰️ Error tracking: Sentry on`.

If the build fails, the old API keeps running: paste the error.

## 4. Web

```bash
cd /var/www/html/tacticoach-frontend
bash scripts/deploy-web.sh
```
Look for:
- `GA4: measurement ID baked in`
- `search: https://tacticoach.co.uk/`
- `Done. Frontend at 21a541b`

If it prints the yellow **reload nginx** line: `sudo nginx -t && sudo systemctl reload nginx`.

## 5. Check on the live site (hard-refresh: Cmd+Shift+R)

1. **Log in** and open a board you saved before today: its thumbnail and any video still show (served from S3).
2. **Upload something new** — a club logo or save a board: it appears in S3 (AWS console → S3 → tacticoach-uploads → Objects).
3. **Editor:** real players have the new look; a pass to a running player arrives with him; 3D view has the **Surroundings** select (Training ground / Night session / Studio).
4. **Admin → Users:** the "Any email / Can't be emailed" filter is there.
5. **Admin → Analytics:** Sentry, PostHog, Google Analytics say *connected*.
6. **Sentry:** no new ZodError events from an empty login form.

## 6. Node 24 (separate, after the deploy has settled)

Do this on its own so a problem is easy to trace. If `node -v` already says v24, skip it.
```bash
which node                     # /usr/bin/node → NodeSource; ~/.nvm/... → nvm
# NodeSource:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g npm@latest pm2@latest
pm2 update
node -v                        # v24.x
curl -s localhost:3001/health  # {"status":"ok",...}
```
With nvm instead: `nvm install 24 && nvm alias default 24 && npm i -g pm2 && pm2 update`.

## Rollback

| What | How |
|---|---|
| API code | `git log --oneline -3`, `git checkout <previous>`, `npm install`, `npm run build`, `pm2 restart tacticoach-api` |
| Uploads back to disk | remove the four `AWS_*`/`S3_BUCKET` lines from `.env` (backup copy is `.env.bak-…`), `pm2 restart tacticoach-api --update-env`. Files on disk were never deleted. |
| Web | `git checkout <previous>` then `bash scripts/deploy-web.sh` |
| Database | not needed: no migrations in this deploy |

The `code: X → Y` line each script prints is the previous commit.
