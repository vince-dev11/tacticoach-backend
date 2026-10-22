# Deploy note: Stripe end to end, welcome emails, invited-coach onboarding (20 Oct 2026)

Setup (accounts, DNS, keys): `Email_And_Stripe_Setup_2026-10-20.md`. Video: `Onboarding_Video/Video_Script_60s.md`.

## What changed

### Stripe: going live only needs the keys

- **Products and prices are created automatically** from our plans table the first time a coach checks out. Nothing is made by hand in the Stripe dashboard. If an admin changes a price, a new Stripe price is created and old subscribers stay on their old price.
- **Changing plan** moves the coach on their existing subscription, prorated. Before, a second subscription would have been created.
- **Profile → Plan & billing** (new) shows the plan and when it renews or ends. Coaches on a card plan get **Manage billing**, which opens Stripe's own page (card, invoices, cancel), and **Change plan**. Players never see it.
- **Cancelling keeps the plan until the paid period ends.** Before, access stopped immediately. A failed card (`past_due`) keeps access while Stripe retries.
- **Books can be bought with a card.** Stripe checkout opens, the 70/30 split is recorded on payment, and an admin refund sends the money back in Stripe. `BOOK_SALES=false` closes the shop.
- **Admin → Users → ⋯ → Refund & end plan…** applies Terms §11: a full refund within 14 days of the first payment, and the plan ends now. Outside the window it asks again before refunding as goodwill.
- Webhooks are deduplicated, so Stripe's retries never double-count a sale. A failed handler is retried.
- **Admin → Overview → Payments & email** shows Stripe on or off (test or live), the webhook secret, books, the sender domain and bounces.

### Emails that arrive, in the coach's language

- Every account email goes out in the coach's language (en de es fr it pt tr): welcome, confirm email, set-password invitation, reminders, activation welcome. The language comes from the sign-up page, the early-access form, or the language the coach uses in the app. Admin can choose it when adding a user.
- **Welcome email on sign-up**, plus a **"you're in" welcome** the first time an invited coach sets their password.
- **Reminders** go out 2 and 6 days after an invitation if the coach hasn't set a password. Each one has a fresh link, and there are never more than 2. The job runs hourly inside the API, with no cron needed.
- **Admin → Users → "Resend to everyone waiting (N)"**: invited coaches get a fresh set-password link, and signed-up but unconfirmed coaches get a fresh confirm link. At most 100 per click (the free plan's daily limit is 300).
- **Bounces:** with the Brevo webhook connected, a bounced or blocked email shows as failed in Admin, with the reason.
- The sender moves to `no-reply@tacticoach.co.uk` through the free Brevo plan, set by `.env` only.

### The personal "we'll show you round" message

- **Admin → Users → ⋯ → Personal welcome** sends a short message in the coach's language. It comes from `info@`, signed with your name, and includes the 60-second video (`WELCOME_VIDEO_URL`). If the coach hasn't set a password yet, it also carries a fresh setup link. Admin shows "welcomed <date>" afterwards.

### Database (migration 56)

- `users`: `locale`, `setup_invited_at`, `setup_reminders_sent`, `welcomed_at`
- `contact_messages.locale`
- `email_log.provider_message_id`
- a new `stripe_events` table

Existing invited coaches are backfilled as "already reminded", so the deploy doesn't send a sudden wave of reminders. Use the Resend button when you're ready.

## Checks run

| Check | Result |
|---|---|
| API typecheck | clean |
| API full suite | **89 files, 1,574 tests passed** (new: `billing.test.ts` 17, `onboarding-email.test.ts` 14) |
| Frontend typecheck | clean |
| Frontend eslint (changed files) | clean |
| Frontend full unit suite (3 batches; `App.tsx` and locales changed) | **209 files, 2,835 tests passed** (new: `billingOnboarding.test.tsx` 10) |
| Locale parity, en-US overlay | passed |

Not run here: live Playwright (it runs on your Mac) and real Stripe or Brevo calls (no keys yet; the tests use a fake Stripe).

## Deploy

```
# 1. API first (migration 56)
cd tacticoach-api && git add -A && git commit -m "Stripe end to end (auto catalogue, plan change, portal, books, refunds), localized onboarding emails, reminders, bounce webhook" && git push
# server: cd /var/www/html/tacticoach-backend && git pull && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh   (runs prisma migrate deploy)

# 2. Web
cd tacticoach-frontend && git add -A && git commit -m "Plan & billing, account language sync, admin onboarding (resend all, personal welcome, refund, setup status)" && git push
# server: cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
```

Without the Stripe and Brevo keys everything still deploys safely: checkout says "not ready yet", and email works as it does today.

## After deploy (10 minutes)

1. API log: `💳 Billing: …` and `✉️` lines. Stripe shows "off" until keys are set.
2. Admin → Overview → **Payments & email** is visible and lists what's still to do.
3. Profile (coach account) → **Plan & billing** shows your plan.
4. Change the app language to Deutsch, sign out and back in, then add a test user with Email language **Auto** → the invitation arrives in German.
5. Then follow `Email_And_Stripe_Setup_2026-10-20.md`: Brevo + DNS → test → **Resend to everyone waiting**; Stripe test keys → the test table there → live keys.
6. Record the video, set `WELCOME_VIDEO_URL`, restart → send yourself a **Personal welcome**.

## Live Playwright to run on your Mac (optional)

`npx playwright test -c playwright.live.config.ts admin auth`. Admin needs `.env.e2e`. These cover sign-up and admin Users. Stripe checkout can't run end to end in Playwright without test keys. Use the manual table in the setup guide.

## Coach acceptance review (football-product-expert, level 2)

- **Coach problem solved:** invited coaches now get an email they can find (own domain, their language) and two gentle nudges. A real person welcomes them with a one-minute video of the first thing to do. Paying, changing plan and cancelling now behave as coaches expect: no double charge, and access lasts for the time they paid for.
- **Must-never respected:** players and parents never see billing (403 `not_a_coach`, and the section is hidden). Under-18s still can't check out. No child's name is in any email. The video brief says to use shirt numbers only.
- **Open (minor):** the reminders and welcome copy in de/es/fr/it/pt/tr were written by me. Ask a native-speaking coach to read one email per language before the first bulk resend.
