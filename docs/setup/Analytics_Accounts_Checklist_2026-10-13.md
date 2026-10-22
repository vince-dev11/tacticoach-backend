# Sentry, PostHog and Google Analytics: the setup checklist (13 Oct 2026)

All three are already built into the app. Each one switches on as soon as its key is in the `.env` files. Nothing in the code needs changing.

Create the accounts yourself, signed in as **tacticoach.co.uk@gmail.com**, then paste the values into the files below. Keep the keys out of chat and out of git: `.env` files are git-ignored, and the `.env.example` files show the names only.

**Where each value goes**

- `web` means `tacticoach-frontend/.env`. On the server, it goes into the web build's env.
- `api` means `tacticoach-api/.env`. On the server, it goes into `/var/www/...` or the PM2 ecosystem.

## 1. Sentry (errors)

1. Go to sentry.io and sign up with Google, using tacticoach.co.uk@gmail.com.
   - Choose the **EU (Frankfurt)** data region. The app's settings expect it (`https://de.sentry.io`).
   - Name the organisation **tacticoach**.
2. Create **two projects**:
   - **React**, named `tacticoach-web`;
   - **Node.js**, named `tacticoach-api`.
3. In each project, copy the DSN (Settings → Client Keys):

   | Variable | File | Value |
   |---|---|---|
   | `VITE_SENTRY_DSN` | web | the DSN of tacticoach-web |
   | `SENTRY_DSN` | api | the DSN of tacticoach-api |

4. **Readable stack traces** (optional, for server builds). Create an **organisation auth token** with the scope `project:releases` (Settings → Auth Tokens). Then set, in **web** only on the server where you build (never commit these):
   - `SENTRY_AUTH_TOKEN`
   - `SENTRY_ORG=tacticoach`
   - `SENTRY_PROJECT=tacticoach-web`
5. **Admin → Analytics** (optional). Create another organisation token with `org:read` and `project:read`, then set in **api**:
   - `SENTRY_API_TOKEN`
   - `SENTRY_ORG=tacticoach`
   - (`SENTRY_API_URL=https://de.sentry.io` is already set.)

## 2. PostHog (product analytics)

1. Go to eu.posthog.com and sign up with tacticoach.co.uk@gmail.com.
   - Choose **EU Cloud**, to match `VITE_POSTHOG_HOST=https://eu.i.posthog.com`.
2. Create a project named **TactiCoach**.
3. In Project settings, copy the **Project API key** (it starts `phc_`).

   | Variable | File | Value |
   |---|---|---|
   | `VITE_POSTHOG_KEY` | web | phc_… |
   | `VITE_POSTHOG_HOST` | web | https://eu.i.posthog.com (already set) |

4. **Admin → Analytics** (optional). Create a **Personal API key** with "Query Read" (Account → Personal API keys), then set in **api**:
   - `POSTHOG_PERSONAL_API_KEY`
   - `POSTHOG_PROJECT_ID`: the number in Project settings.

## 3. Google Analytics 4

1. Go to analytics.google.com, signed in as tacticoach.co.uk@gmail.com.
   - Create an account **TactiCoach** and a property **tacticoach.co.uk**, with time zone London and currency GBP.
2. Add a **Web data stream** for `https://tacticoach.co.uk`, then copy the **Measurement ID** (`G-…`).

   | Variable | File | Value |
   |---|---|---|
   | `VITE_GA_MEASUREMENT_ID` | web | G-… |

   GA only loads after a visitor accepts cookies (Consent Mode v2, already built in).
3. **Admin → Analytics** (optional).
   1. Copy the **Property ID** (a number, under Property settings) into **api** as `GA4_PROPERTY_ID`.
   2. In Google Cloud (same Gmail), create a project, enable the **Google Analytics Data API**, create a **service account** and download its JSON key.
   3. Save the key on the server at `/var/www/secrets/ga4-service-account.json`.
   4. In GA4, go to Admin → Property access management and add the service account's email as **Viewer**.

## Status (13 Oct 2026)

- **Sentry:** org `tacticoach` (EU). Projects `tacticoach-web` and `tacticoach-api` are created.
- **PostHog:** EU Cloud, project 304217.
- **GA4:**
  - Account **TactiCoach** (411701966), property **tacticoach.co.uk** (558614691), set to UK / GMT / GBP.
  - Web stream "TactiCoach web" (16118931745). Measurement ID **G-6BQLKB0EYX**.
  - Data sharing:
    - Off: "Google products & services", "Recommendations".
    - On: "Modeling contributions", "Technical support".
  - Marketing emails unticked.
- **Already in the local `.env` files** (none of these values are secrets):
  - web: `VITE_GA_MEASUREMENT_ID`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN`
  - api: `GA4_PROPERTY_ID`, `SENTRY_DSN`, `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`
- **Still to do:**
  - Copy every value above into the server env.
  - (Optional) Add `POSTHOG_PERSONAL_API_KEY`. This one is a secret: create it yourself.
  - (Optional) Create the GA4 service account.

## 4. After pasting

Local:

```
# web
npm run dev
# api
npm run dev
```

Server: rebuild the web with the new env (`./scripts/deploy-web.sh`) and restart the API. The `VITE_` values are baked in at build time, so a web rebuild is required.

**Check each one:**

- **Sentry:** in the browser console on the live site, run `throw new Error('sentry test')`. It shows in tacticoach-web within a minute.
- **PostHog:** open the site, accept cookies and click around. Activity → Live events shows it.
- **GA4:** open the site and accept cookies. Reports → Realtime shows you.
- **Admin → Analytics:** each source says "Connected" once its keys are in.

The detailed guides are already in this folder: `Error_Tracing_Guide.md`, `GA4_Setup_Guide.md` and `Admin_Analytics_Setup.md`.
