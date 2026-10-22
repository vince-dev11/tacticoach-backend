# TactiCoach — Admin → Analytics setup

**What it is:** a new **Analytics** tab in the admin panel (`/admin/analytics`) that shows, in one place:

| View | What you see | Fed by |
|---|---|---|
| **Countries** | Bubble map + table: users, new users, sessions, sign-ups, sign-up rate, checkouts, purchases, checkout→paid rate per country | Google Analytics |
| **Features** | What was created (sign-ups, boards, sheets, sessions, books, feedback, paid) per week · every product event with counts and users · any feature **by country** · weekly trend | Our database (always) + Google Analytics + PostHog |
| **Funnels** | Pricing → checkout → paid · Sign-up → first board → first export · Book opened → sample read → reviewed — strictly ordered per person (PostHog) and users-per-step (GA4), plus the purchase funnel **by country** | PostHog + Google Analytics |
| **Health** | Emails sent / failed, new leads waiting · errors per day · open issues in both Sentry projects with links | Our database (always) + Sentry |

A **Last 7 / 30 / 90 days** switch applies to every view. Results are cached on the server for 15 minutes.

Each source is optional. A source that isn't connected shows *how to connect it* in its panel; a source that fails shows the reason. The panels fed by our own database always work, so the tab is useful from the first deploy even before any key is set. A preview with sample numbers is in `admin-analytics-preview.html`.

**All keys go in the API server's `.env`** (`/var/www/html/tacticoach-backend/.env`). Type them on the server; never paste them in chat or commit them. The browser never sees them — it only calls our own `/api/admin/analytics/*` endpoints, which are owner-only.

---

## 1. Google Analytics (countries, features by country, funnel steps)

Uses the **GA4 Data API** with a Google **service account** (a robot Google account that can only read reports).

1. Go to **console.cloud.google.com** → create a project, e.g. `tacticoach-analytics` (any Google account works; it doesn't have to own the GA4 property).
2. **APIs & Services → Library** → search **Google Analytics Data API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Name: `admin-analytics-reader`. No roles needed. Create.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A file downloads. This is the secret.
5. Copy the file to the server, outside the web root, readable by the API user only:

   ```bash
   sudo mkdir -p /var/www/secrets
   sudo mv ~/tacticoach-analytics-xxxx.json /var/www/secrets/ga4-service-account.json
   sudo chown <api-user>:<api-user> /var/www/secrets/ga4-service-account.json
   sudo chmod 600 /var/www/secrets/ga4-service-account.json
   ```

6. Give the robot read access to GA4: **analytics.google.com → Admin → Property → Property access management → Add users** → paste the service account's email (`admin-analytics-reader@…iam.gserviceaccount.com`) → role **Viewer**.
7. Find the **Property ID**: Admin → Property → **Property settings** (a number like `498231057`, not the `G-…` measurement ID).
8. In the API `.env`:

   ```bash
   GA4_PROPERTY_ID=498231057
   GA4_SERVICE_ACCOUNT_JSON=/var/www/secrets/ga4-service-account.json
   ```

   (Docker: the value can also be the JSON text itself.)

**Quota:** the free GA4 Data API allows about 200,000 tokens a day; one Analytics page load uses roughly 30–60. The 15-minute cache keeps this far under the limit.

**Data starts when GA4 starts.** Until the `VITE_GA_MEASUREMENT_ID` build is live (see `GA4_Setup_Guide.md`) and coaches have visited, the panels will be connected but empty.

---

## 2. PostHog (ordered funnels, features by country per person)

1. **PostHog → Settings → Personal API keys → Create**. Scope: **Query: Read** only. Copy the key (starts with `phx_`).
2. Project ID: **Settings → Project → Project ID** (a number).
3. In the API `.env`:

   ```bash
   POSTHOG_HOST=https://eu.posthog.com      # or https://us.posthog.com
   POSTHOG_PROJECT_ID=12345
   POSTHOG_PERSONAL_API_KEY=phx_...
   ```

**Note on country:** PostHog's `$geoip_country_code` comes from its own GeoIP lookup of the visitor's IP at event time and does **not** depend on cookie consent, so this panel counts every visitor. GA4's country panel counts consented visitors fully and models the rest.

**Budget:** the free plan has an hourly read budget for API queries. The page runs at most 5 PostHog queries per range per 15 minutes. If you ever see `api_queries_budget_exceeded` in a panel, wait an hour.

---

## 3. Sentry (errors per day, open issues)

1. **Sentry → Settings → Developer settings → Organization tokens → Create new token**. Scopes: **org:read**, **project:read**, **event:read**. Copy it (`sntrys_…`).
2. Organisation slug: the part of the URL after `sentry.io/organizations/` (or in Settings → General).
3. In the API `.env`:

   ```bash
   SENTRY_API_URL=https://de.sentry.io    # EU region; use https://sentry.io for US
   SENTRY_API_TOKEN=sntrys_...
   SENTRY_ORG=tacticoach
   SENTRY_PROJECT_API=tacticoach-api
   SENTRY_PROJECT_WEB=tacticoach-web
   ```

This is a **different** token from `SENTRY_AUTH_TOKEN` (which uploads source maps at build time) and from `SENTRY_DSN` (which sends errors). Keep the three separate; each has the least permission it needs.

---

## 4. Deploy and check

```bash
cd /var/www/html/tacticoach-backend
git pull && npm ci && npm run build
pm2 restart tacticoach-api --update-env
```

Frontend: `git pull && npm ci && npm run build` (nginx serves `dist/`, no restart).

Open **Admin → Analytics**. The chips at the top show which sources are connected. If one says *error*, hover it or open its panel: the message names the failing call and status (e.g. `GA4 runReport failed (403)` = the service account wasn't added to the property; `PostHog query failed (401)` = wrong key or project).

---

## 5. Reading it

- **Countries:** sort by users to see the market; **sign-up rate** (sign-ups ÷ new users) shows where the landing page converts; **checkout → paid** shows where payment fails (a low rate in one country usually means the price point or a card issue there).
- **Features:** pick a group chip (Board, Sheets, Sessions, …), then click a feature to see its **by-country** split on the right. The weekly chart shows whether use is growing.
- **Funnels:** the PostHog funnel is the truthful one (same person, in order, within 30 days). The GA4 one counts anyone who did each step and works without PostHog. The country table underneath is the purchase funnel per country.
- **Health:** a red *emails failed* count means SMTP trouble — check `pm2 logs` for `[emails]`. Issues link straight into Sentry.

---

## 6. Where the code is

**API (`tacticoach-api`)**

- `src/modules/admin/analytics/sources.ts` — GA4 (service-account JWT → token, `runReport`), PostHog (`HogQLQuery`, `FunnelsQuery`), Sentry (issues, `stats_v2`), 15-minute cache.
- `src/modules/admin/analytics/analytics.service.ts` — the four views, the feature-event groups, the funnel definitions, ISO-week bucketing, DB counts.
- `src/modules/admin/analytics/analytics.routes.ts` — `GET /api/admin/analytics/{status,countries,features,funnels,health}?range=7d|30d|90d`, registered inside `adminRoutes` (owner-only).
- `src/config/env.ts`, `.env.example` — the variables above.
- `tests/admin-analytics.test.ts` — 8 tests: owner gate, range validation, unconfigured sources, DB trend by ISO week, GA4 rows → countries table (with a real signed JWT against a mocked Google), cache, error state, ISO week edge cases.

**Frontend (`tacticoach-frontend`)**

- `src/pages/AdminAnalytics.tsx` + `adminAnalytics.css` — the page (views, range, bubble map, tables, bars, weekly charts, funnels, issues).
- `src/lib/adminAnalytics.ts` — typed API client. `src/lib/countryCentroids.ts` — bubble positions and flag emoji.
- `src/pages/Admin.tsx` — the **Analytics** tab and route.
- `tests/unit/adminAnalytics.test.tsx` — 6 tests: source chips and connect hints, range re-query, DB numbers without any source, error reasons, health, flags.

**Adding a metric:** add the event to `FEATURE_EVENTS` (API) — the frontend reads the groups from the response, so no UI change is needed. Adding a funnel: add it to `FUNNELS`.
