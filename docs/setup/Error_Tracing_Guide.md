# TactiCoach — Error Tracing Guide

**What this gives you:** every failure is caught, whether it happens in the coach's browser, in the API or in a background job. You get told about it, and you can follow it from "the save button did nothing" to the exact line of code that threw, in a few clicks.

**Tool:** Sentry. It is built into both repos and switched off until you add the keys (section 3).

---

## 1. How it fits together

```
 Coach's browser                         API server (Fastify)                Sentry
 ───────────────                         ────────────────────                ──────
 apiFetch("/api/clubs/42")
   ├─ X-Request-Id: 7f3a…    ─────────►  request.id = 7f3a…
   └─ sentry-trace / baggage ─────────►  (joins the same trace)
                                          logs every line with reqId=7f3a…
                                          route throws ──► 500
                                            ├─ captureError ─────────────────► Issue (API project)
                                            │    tags: request_id=7f3a…            route=/api/clubs/:id
                                            │          user.id=118                 status=500
                                            └─ body: { requestId: "7f3a…" }
   ◄──── 500 + X-Request-Id: 7f3a… ─────
   reportError ────────────────────────────────────────────────────────────────► Issue (Web project)
        tags: request_id=7f3a…, api_route=/api/clubs/:id                        same trace ID
```

Four things tie it together:

| Thing | What it is | Where you see it |
|---|---|---|
| **Request ID** | One ID per API call. The browser creates it, and the API reuses it (or makes its own). | `X-Request-Id` header · `requestId` in every 5xx response · `reqId` on every pm2 log line · Sentry tag `request_id` |
| **Trace ID** | Sentry's link between the browser event and the API event for the same action. | Sentry → the issue → **Trace** |
| **Event ID** | The ID of one Sentry report. | Shown to the coach on the crash screen as an **Error reference**. |
| **User ID** | The numeric account ID only. Never the email. | Sentry → the issue → **User** |

---

## 2. What is reported, and what is not

**Reported automatically**

| Where | What | Sentry tags |
|---|---|---|
| API | Any 5xx from any route (unhandled exceptions, Prisma/DB failures, crashes) | `request_id`, `route`, `http.method`, `status`, user |
| API | Handled failures that used to die silently in the logs: email sending, contact form, coach-page contact relay, collaboration applications, AI generation (layout, animation, reel copy), AI credit accounting, Stripe refund lookup | `source` or `step`, plus `email_kind` / `ai_kind` |
| API | Background job failures (trial-reminder sweep) | `source=job:trial-reminders` |
| API | The server failing to boot | `source=boot`, level `fatal` |
| API | Uncaught exceptions / unhandled promise rejections | Sentry's defaults |
| Browser | Any render crash (the app would otherwise show a white screen) | `area=render`, React component stack, level `fatal` |
| Browser | Any API call that comes back 5xx | `area=api`, `request_id`, `api_route`, `api_status` |
| Browser | Uncaught errors and promise rejections | Sentry's defaults |
| Browser | 10% of page loads and navigations, for speed | Performance tab |

**Deliberately NOT reported**

- **4xx responses** (wrong password, no permission, validation errors). That is the app working as designed, and reporting them would bury the real failures.
- **Network hiccups and noise:** offline laptops, aborted requests, `ResizeObserver` warnings, browser extensions.

**Never sent, even when an error is reported.** Scrubbing is enforced in code and covered by tests on both sides:

- passwords, tokens, cookies, `Authorization` headers;
- request bodies (they can contain player notes and children's names);
- reset, verification, guardian, invite and share links: the token part of the URL becomes `[redacted]`;
- email addresses, IP addresses and usernames: the event keeps the numeric account ID only.

The scrubbing code:

- API: `tacticoach-api/src/lib/observability-scrub.ts`
- Browser: `tacticoach-frontend/src/lib/monitoringScrub.ts`

---

## 3. One-time setup (about 20 minutes)

### 3.1 Create the Sentry account

1. Sign up at **sentry.io** and choose the **EU (Frankfurt) data region**. Your users are UK/EU, and you can't change the region later.
2. Create an organisation, e.g. `tacticoach`.
3. Create **two projects**:
   - `tacticoach-api`, platform **Node.js**;
   - `tacticoach-web`, platform **React**.

   Two projects keep browser noise separate from server failures, and each gets its own alert rules.
4. Copy each project's **DSN** from Project → Settings → Client Keys.

   The DSN isn't secret: it's baked into the browser bundle, and it can only *send* events.
5. Create an **auth token** for source-map uploads under Settings → Auth Tokens → *Organization token*.

   **This token is secret.** It goes on the server only: never in chat, never in git, never in an image layer.

**Cost:** the free Developer plan covers 5,000 errors a month, one user and 30 days of history. That's enough to start. Team is about $26/month if you need more users or volume ([Sentry pricing](https://sentrypricing.com/free-plan)). With the filtering above, a healthy app should stay well under the free limit.

### 3.2 API server (`/var/www/html/tacticoach-backend`)

Add these to the server's `.env`. Type them on the server, don't paste them anywhere else:

```bash
SENTRY_DSN=https://<key>@o<org>.ingest.de.sentry.io/<api-project-id>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Deploy as usual, adding the release name so every error is pinned to the build that threw it:

```bash
cd /var/www/html/tacticoach-backend
git pull
npm ci
npm run build
export SENTRY_RELEASE=$(git rev-parse --short HEAD)
pm2 restart tacticoach-api --update-env
pm2 logs tacticoach-api --lines 20   # expect: "🛰️  Error tracking: Sentry on"
```

**Optional, for performance tracing of database and HTTP calls.** Error capture works without this. To also get automatic timing of every Prisma query and outgoing HTTP call, start Node with the instrumentation file preloaded. In your pm2 ecosystem file:

```js
{ name: 'tacticoach-api', script: 'dist/index.js', node_args: '--import ./dist/instrument.js' }
```

Or use `npm run start:traced`, which does the same.

### 3.3 Frontend build (`dist/` served by nginx)

On the server, in the frontend's `.env`, or exported in the shell before building:

```bash
VITE_SENTRY_DSN=https://<key>@o<org>.ingest.de.sentry.io/<web-project-id>
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_ORG=tacticoach
SENTRY_PROJECT=tacticoach-web
SENTRY_AUTH_TOKEN=<the secret token>      # server only
```

Build with the release name:

```bash
export VITE_SENTRY_RELEASE=$(git rev-parse --short HEAD)
npm run build
ls dist/assets/*.map 2>/dev/null | wc -l   # must print 0 — maps are uploaded, then deleted
```

**How source maps work here:** with the three `SENTRY_*` build variables set, the build makes hidden source maps, uploads them to Sentry under the release, and deletes them from `dist/`. Visitors still can't see your source code, but Sentry's stack traces show `Editor.tsx:212` instead of `index-8f2a.js:1:48213`. Without the token, the build behaves exactly as before and makes no maps.

**Docker:** the frontend `Dockerfile` accepts the same values. The auth token goes in as a BuildKit secret, so it never lands in the image:

```bash
SENTRY_AUTH_TOKEN=... docker build --secret id=sentry_token,env=SENTRY_AUTH_TOKEN \
  --build-arg VITE_API_URL=https://api.tacticoach.co.uk \
  --build-arg VITE_SENTRY_DSN=... --build-arg VITE_SENTRY_RELEASE=$(git rev-parse --short HEAD) \
  --build-arg SENTRY_ORG=tacticoach --build-arg SENTRY_PROJECT=tacticoach-web -t tacticoach-frontend .
```

### 3.4 Prove it works (after every deploy that touches this)

1. **API:** sign in to the site as the owner, open the browser console, and run the snippet below. Replace the URL with your API's address, the same value as `VITE_API_URL`.

   ```js
   fetch('https://api.tacticoach.co.uk/api/admin/monitoring/test', {
     method: 'POST',
     headers: { Authorization: 'Bearer ' + localStorage.getItem('tc_token') },
   }).then((r) => r.json()).then(console.log)
   ```

   It prints a 500 containing a `requestId`.

   Within about a minute, **tacticoach-api** in Sentry should show the issue *"Sentry test error — thrown on purpose…"*, tagged with that `request_id`, `route=/api/admin/monitoring/test` and your user ID. **tacticoach-web** also gets the browser's side of the same request.
2. **Source maps:** open the web event's stack trace. File names should be `.ts`/`.tsx`. If they're minified, the release names don't match (see Troubleshooting).
3. Resolve the test issue in Sentry.

### 3.5 Alerts (Sentry → Alerts → Create Alert)

Set these up once per project:

| Alert | Rule | Send to |
|---|---|---|
| New problem | *A new issue is created* | Email (and Slack, if you connect it) |
| Something broke again | *An issue changes state from resolved to unresolved* (regression) | Email |
| Spike | *Number of events in an issue > 20 in 5 minutes* | Email + Slack |
| Payments/boot | Issues tagged `source:boot` or `source:webhook:stripe`, *any event* | Email immediately |

Keep the list short. An alert that fires every day stops being read.

---

## 4. Day-to-day: tracing an error

### A) A coach sends a screenshot of the crash screen

The crash screen shows **"Error reference: 0123456789abcdef…"** with a Copy button.

1. Sentry → **Issues** → search box → paste the reference. It's the event ID, and it opens that exact event.
2. Read the event from top to bottom:
   - **Exception + stack trace:** the file and line (source-mapped).
   - **React component stack:** which component tree was rendering.
   - **Breadcrumbs:** the clicks, navigations and API calls in the seconds before the crash, with the API calls' URLs scrubbed.
   - **User:** the account ID. Look them up in Admin if you need the plan or club.
   - **Release:** the git SHA, so you know which build they were on.
3. Fix, deploy, and mark it **Resolved in next release**. If it comes back, it re-opens and you get the regression alert.

### B) A coach says "it said something went wrong" or "save failed"

Every 5xx response carries a `requestId`, and the frontend keeps it on the error it throws (`error.requestId`).

1. Get the time and the account (or the request ID, if the UI showed it).
2. **tacticoach-web** → filter `user.id:<id>` or `api_status:500` around that time. The event's tags include `request_id`.
3. Click **Trace** on the event. It shows the browser request and the API's handling as one timeline, including the API event with the server-side stack trace.
4. If you'd rather use the server logs:

   ```bash
   pm2 logs tacticoach-api --lines 2000 --nostream | grep '"reqId":"<request-id>"'
   ```

   Every line that request logged has the same `reqId`: the route, the error, and how long it took.

### C) You get an alert: "New issue in tacticoach-api"

1. Open it. **Tags** show which route, status and how many users are affected. **Events** shows every occurrence.
2. **Stack trace:** the throwing line. **Additional data:** any `extra` context, already scrubbed.
3. To see the matching browser side, copy `request_id` and search **tacticoach-web** for `request_id:<id>`.

### D) Something happens in the background (a job, email, or payment step)

These have no request and no user watching, so before this change they failed silently.

- Filter **tacticoach-api** by tag:
  - `source:job:trial-reminders`: the hourly trial-reminder sweep broke.
  - `source:email` with `email_kind:<kind>`: an email couldn't be sent. The recipient's address is only in the server log and the email log table, not in Sentry.
  - `source:webhook:stripe`: a payment/refund step failed.
  - `source:ai:credits`: generation worked but credit accounting didn't.

### Useful Sentry searches

| Want | Search |
|---|---|
| One request, both sides | `request_id:7f3a9c21-…` |
| Everything one coach hit | `user.id:118` |
| One endpoint's failures | `route:/api/sessions/:id` (API) · `api_route:/api/sessions/:id` (web) |
| Only crashes | `area:render` |
| Only a release | `release:a1b2c3d` |
| AI failures | `ai_kind:animation` |

---

## 5. For developers: using it in new code

**API.** Import from `src/lib/observability.ts` only, never `@sentry/node` directly:

```ts
import { captureError } from '../../lib/observability.js'

try {
  await somethingThatMayFail()
} catch (err) {
  request.log.error({ err }, 'thing failed')          // log line, carries reqId
  captureError(err, { request, tags: { step: 'thing' } })
  // …then degrade gracefully or rethrow
}
```

- Thrown errors that reach the global error handler are reported automatically. Only use `captureError` for errors you catch and handle.
- With no request (jobs, scripts), pass `{ source: 'job:name' }`.
- Put identifiers in `tags` (searchable, strings only) and detail in `extra`. Never put emails, names or tokens in either.

**Browser.** Import from `src/lib/monitoring.ts`:

```ts
import { reportError, addBreadcrumb } from '../lib/monitoring'

addBreadcrumb('editor', 'export started', { format: 'mp4' })   // context for later errors
try { await exportVideo() } catch (err) {
  reportError(err, { tags: { area: 'export', format: 'mp4' } })
  showToast(t.export.failed)
}
```

- `apiFetch` already reports 5xx responses. Don't report the same failure again in the caller.
- Render crashes are already caught by `ErrorBoundary`.

---

## 6. Privacy and compliance

- Sentry becomes a **sub-processor**. Add it to the privacy policy's list of processors (error monitoring, EU-hosted) and accept Sentry's DPA under Settings → Legal.
- What it receives is limited by design (section 2): no bodies, no emails, no tokens, and account IDs only.
- Retention is 30 days on the free plan, which is fine for debugging and nothing is kept longer than needed.
- PostHog (product analytics and session replay) is unchanged and separate. Sentry session replay is **not** enabled. If you want it later for crashes only, turn it on in `src/lib/monitoring.ts` with everything masked.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot log says `Error tracking: off` | `SENTRY_DSN` not in the API's env | Add it, then `pm2 restart tacticoach-api --update-env` |
| Nothing from the browser | `VITE_SENTRY_DSN` wasn't set **at build time** | Vite bakes env into the bundle, so rebuild with it set |
| Browser stack traces minified | Release mismatch, or the maps weren't uploaded | `VITE_SENTRY_RELEASE` must equal the release in Sentry → Releases. Check that the build output mentions the upload |
| `.map` files in `dist/` | Upload failed, so they weren't deleted | Check the auth token scopes (`project:releases`, `org:read`), then rebuild. Never deploy with maps present |
| CORS error mentioning `sentry-trace` | The API isn't allowing the trace header | `@fastify/cors` reflects requested headers by default. If you set `allowedHeaders` explicitly, include `x-request-id`, `sentry-trace`, `baggage` |
| Too many events or near quota | A noisy error | Fix it, or add it to `ignoreErrors` in `monitoring.ts`. Lower `*_TRACES_SAMPLE_RATE` |

---

## 8. What changed in the code

**API (`tacticoach-api`)**

- `src/instrument.ts`: starts Sentry first, with sampling, environment and release. Off without `SENTRY_DSN`.
- `src/lib/observability.ts`: `captureError`, `genRequestId`, `flushMonitoring`. The only file that uses Sentry.
- `src/lib/observability-scrub.ts`: removes secrets from every event.
- `src/app.ts`:
  - request ID per request (`genReqId`);
  - `X-Request-Id` on every response;
  - the header is exposed through CORS.
- `src/middleware/error-handler.ts`: reports 5xx with context, logs them through Fastify so they carry `reqId`, and adds `requestId` to the 5xx body.
- `src/index.ts`: reports boot failures and prints the tracking status.
- Handled failures now reported in:
  - `jobs/trial-reminders.ts`
  - `lib/emails.ts`
  - `modules/ai/ai.routes.ts`
  - `modules/contact/contact.routes.ts`
  - `modules/coach-page/coach-page.routes.ts`
  - `modules/collaborations/collaborations.routes.ts`
  - `modules/webhooks/stripe.routes.ts`
- `POST /api/admin/monitoring/test`: an owner-only test route that throws on purpose.
- `.env.example` and `package.json` (`start:traced`).
- `tests/observability.test.ts`: 9 tests covering request IDs, log-injection defence, 5xx capture and reference, no 4xx capture, scrubbing, and the owner test route.

**Frontend (`tacticoach-frontend`)**

- `src/lib/monitoring.ts`: Sentry setup, tracing to the API only, noise filters, `reportError`, `reportRenderCrash`, `setMonitoringUser`, `addBreadcrumb`.
- `src/lib/monitoringScrub.ts`: removes tokens from URLs and breadcrumbs, and keeps only the account ID.
- `src/lib/api.ts`:
  - `X-Request-Id` on every call;
  - `ApiError.requestId`;
  - 5xx reported and grouped by endpoint template.
- `src/components/ErrorScreens.tsx`: the crash is reported with the React component stack, and the crash screen shows the **Error reference** with a Copy button. The new copy is in 11 languages.
- `src/main.tsx`: `initMonitoring()` before the first render.
- `src/lib/analytics.ts` and `src/context/AuthContext.tsx`: the account ID is attached on login and on session restore, and cleared on logout.
- `vite.config.ts`: hidden source maps are uploaded and then deleted, only when the Sentry token is present.
- `Dockerfile`: Sentry build arguments, with the token as a BuildKit secret.
- `.env.example`
- `tests/unit/monitoring.test.tsx`: 8 tests covering the request-ID header, 5xx reporting with the echoed ID and fingerprint, no 4xx reporting, route templates, scrubbing, and the crash screen reference.
