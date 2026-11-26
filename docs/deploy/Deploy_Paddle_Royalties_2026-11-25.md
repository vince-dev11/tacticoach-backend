# Deploy note: Paddle billing + author royalty payouts (25 Nov 2026)

Brief: `tacticoach-frontend/docs/briefs/2026-11-25-paddle-billing.md`. Setup: `docs/setup/Paddle_Setup_2026-11-25.md`.

**Safe to deploy before Paddle is set up.** With no `PADDLE_API_KEY`, everything behaves exactly as before: Stripe if its keys are set, otherwise "billing isn't on yet". The new Admin → Payouts tab works straight away; it only reads book sales.

## What ships

**API**

- `config/paddle.ts`: Paddle client (fetch; no new dependency), webhook signature check, `billingProvider()`.
- `membership/paddle-billing.ts`:
  - plan products and prices created on first use (`paddle_catalog`);
  - customer;
  - transaction, plan change in place, cancel at period end, customer portal;
  - Admin refund (an adjustment);
  - referral free months (a discount).
- `webhooks/paddle.routes.ts` at **`POST /api/webhooks/paddle`**. Events handled:
  - `transaction.completed`;
  - `subscription.created`, `subscription.updated`, `subscription.canceled`;
  - `adjustment.created`, `adjustment.updated`.
- Books through Paddle (`paddleBookCheckout`), still behind `BOOK_SALES`.
- `ebooks/royalties.service.ts` + Admin routes, all owner only:
  - `/api/admin/author-payouts` (GET roster, POST record);
  - `/:id/void`;
  - `/user/:userId`;
  - `/export.csv?month=`;
  - `PUT /api/admin/author-payees/:userId`.
- The author dashboard shows paid out / owed / still in the refund window from the ledger.
- `GET /api/admin/billing/status` also reports Paddle (additive).

**Frontend**

- The `/checkout` page (Paddle overlay; also Paddle's default payment link).
- `lib/paddle.ts`.
- Admin → **Payouts**.
- Dashboard payout lines.
- Copy in 7 locales: "Confirming your payment…" without "Stripe"; the help text says Paddle.
- **CSP** (`nginx.conf`):
  - `script-src` and `style-src` add `https://cdn.paddle.com`;
  - `frame-src` adds `https://buy.paddle.com https://sandbox-buy.paddle.com`.
- `nginx/spa-routes.conf` regenerated (adds `/checkout`).

## Steps

1. **Database:** `npx prisma migrate deploy` applies **`69_paddle_billing`**. It only adds:
   - column `users.paddle_customer_id`;
   - tables `paddle_events`, `paddle_catalog`, `author_payouts`, `author_payees`.

   Then `npx prisma generate`.
2. **Deploy the API, then the web app.** nginx must reload for the new CSP and the `/checkout` route.
3. **When you set up Paddle** (sandbox first):
   - **API `.env`:**
     - `PADDLE_API_KEY`;
     - `PADDLE_ENV=sandbox` (later `production`);
     - `PADDLE_WEBHOOK_SECRET`;
     - optional `PADDLE_BOOK_TAX_CATEGORY=ebooks` once Paddle approves that category.
   - **Web build:**
     - `VITE_PADDLE_CLIENT_TOKEN` (the client-side token, `test_…` / `live_…`, never the API key);
     - `VITE_PADDLE_ENV=sandbox|production`.
   - **Paddle → Events → Notifications:** `https://tacticoach.co.uk/api/webhooks/paddle` with the six events above.
   - **Paddle → Checkout → Default payment link:** `https://tacticoach.co.uk/checkout`.
   - **Paddle → Settings → Sales tax:** prices **inclusive** of tax (decision D).
4. **Sandbox run** (setup doc section 8). Test card `4242 4242 4242 4242`, CVV 100:
   - buy Pro;
   - upgrade;
   - cancel;
   - Admin refund;
   - a book (`BOOK_SALES=true` in sandbox only);
   - check the browser console for any CSP block (Chrome and iPad Safari).

## Sandbox test, 26 Nov 2026 (local API through a Cloudflare quick tunnel)

| Step | Result |
|---|---|
| Buy Pro monthly (card 4242…) | ✅ Paddle checkout opened from TactiCoach, £8.99 with tax included, back to `/billing/success` |
| Webhook → plan on | ✅ `subscription.created` + `transaction.completed` delivered; coach became Pro until 26 Dec |
| Upgrade Pro → Club 5 | ✅ Same subscription, no second checkout; Paddle bills the difference at renewal (£40.97 on 26 Dec) |
| Manage billing (Paddle portal) | ✅ Opens; shows next bill and the credit |
| Cancel in the portal | ✅ Webhook → "Club 5 is canceled. You keep it until 26 December 2026" |
| Duplicate events | ✅ Replayed events were skipped (`paddle_events`) |

**Every plan, from separate accounts (run `p6gkgv`):**

| Account | Plan | How | Result |
|---|---|---|---|
| Coach "Decline" | Pro monthly | Declined card, then 3-D Secure (approve) | ✅ Decline message, no access; then Pro active |
| Coach "Basic" | Basic yearly £45 | Success card | ✅ Basic, annual, renews 26 Nov 2027, 10 videos/month |
| Coach "Proyear" | Pro yearly £79 | Visa debit | ✅ Pro, annual |
| Coach "Club10" | Club 10 monthly £39.99 | 3-D Secure failed, then approved | ✅ "Not charged" on fail; then 10 seats, club owner |
| Coach "Club20" | Club 20 yearly £700 → Club 20 monthly | New checkout, then switch | ✅ 20 seats; the unused year became Paddle credit (£0 today) |
| Club account | Club 5 yearly £250 | Success card | ✅ 5 seats, owner |
| Coach "Prices" | Basic monthly £4.99 → Club 10 yearly | New checkout, then switch | ✅ Charged now; Club 10 annual |
| Player (adult) | — | API checkout | ✅ 403 `PLAYER_ACCOUNT`; no plans shown on the site |
| Parent | — | API checkout + pages | ✅ 403 `PARENT_ACCOUNT`; lands on /family; no plans shown |

All 10 plan × cycle prices in Paddle match our price list (Basic £4.99/£45, Pro £8.99/£79, Club 5 £24.99/£250, Club 10 £39.99/£400, Club 20 £69.99/£700). GST/VAT was taken out of the price, never added on top.

**Bugs found in this second round and fixed:**

- **Quantity stepper (money):** Paddle's checkout let a coach pick 2+ of a plan and pay for each while getting one. Prices are now created quantity 1 only (catalog keys end `:q1`; older prices still map), the book price too, and the webhook flags any quantity above 1 in Sentry.
- **Monthly ↔ yearly switch failed with a bare 500:** Paddle allows only an immediate charge when the interval changes. Interval changes now charge today with `prevent_change` on a failed card (same-interval changes still go on the next bill, P4). A refused change answers 402 `payment_failed` or 502 `change_failed` with a clear, translated message.
- **Switch confirm:** a yearly switch showed the per-month figure; it now shows "£400/year" and, for an interval change, that today's charge takes off what's left of the current plan (any excess becomes credit).
- **Player/parent:** a signed-in player saw "Start Pro" and "Your free trial has ended" on the home page. Plans and the early-access block are now hidden for players and parents.
- **Tests:** `vitest.config.ts` pins `PADDLE_*` to empty, so a developer `.env` with sandbox keys no longer flips the Stripe tests to Paddle.

**Admin refund and books (same day, local owner `owner@tacticoach.test`):**

- Admin → Users → Basic-yearly coach → Refund & end plan: ✅ plan ended at once; Paddle shows the subscription Canceled and "Full refund requested" on the £45 payment (Paddle reviews refunds; on approval `adjustment.updated` reverses commission). The dialog said "in Stripe" for a Paddle plan; now it names Paddle.
- Book £4.99 bought by a Pro coach: ✅ "It's yours!", in the library; the author's ledger shows £2.96 pending (70% of £4.23 net of GST), 14-day hold. `BOOK_SALES` defaults to on (`env.ts`), nothing to add.
- **Bug fixed:** `PADDLE_BOOK_TAX_CATEGORY` held a note ("(leave empty for now)") and every book checkout failed with a 500. The value is now checked against Paddle's categories and falls back to `standard`.

**Still not run:** a real renewal decline (needs the renewal date to pass; Paddle's sandbox can't fast-forward a subscription from here), PayPal / Apple Pay / Google Pay (sandbox wallets need their own test accounts).

**Bugs found and fixed in the web app:**

- Change plan page: a signed-in coach saw "Request early access" on every card and "Your free trial has ended" while on an active plan. Now shows the real buttons, marks "Your plan" (club size and cycle included), and "Switch to this plan" on the others.
- Switching plans happened on one press with no word about the bill. Now a confirm shows the new price and says the next bill is adjusted.
- Plans stayed invisible after a hard refresh for a signed-in coach (the scroll-in animation registered sections before sign-in had loaded).
- Profile → Plan & billing: a Paddle plan read "until …" with no Manage billing. Now "Renews on …" + Manage billing.
- Admin: "Refund & end plan" was Stripe-only. Now Paddle too.

Tests: `tests/unit/pricingSignedIn.test.tsx` (new), `billingOnboarding.test.tsx` (PADDLE-PLANLINE).

**Local testing tip:** a quick tunnel gets a new address every restart, so update the Paddle destination each time. Paddle stops retrying after 3 attempts; resend with `node scripts/paddle-replay-failed.mjs` (API repo; `--dry-run` lists only). An already replayed notification can't be replayed again (404), which is harmless.

## Before turning on books in live

- **Paddle's written OK.** Their policy prohibits marketplaces. Describe it as TactiCoach publishing books under an author licence with a 70% royalty.
- **The author agreement** says licence + royalty, paid monthly after the 14-day refund window, minimum £10.

## Owner choices built as assumptions (change in one place)

- **Royalty base:** 70% of the price before tax; the Paddle fee comes from our 30%.
- **Hold and minimum:** 14 days (`ROYALTY_HOLD_DAYS`); £10 minimum payout (`ROYALTY_MIN_PAYOUT_PENCE`).
- **Plan change (P4, decided 26 Nov 2026: "now"):** every change is charged at once, less the unused part of the current plan (`prorated_immediately`); a smaller plan leaves Paddle credit; a declined card changes nothing (`prevent_change`).
- **Refund policy (B, rewritten 26 Nov 2026):** full refund within 14 days of the first payment, nothing deducted; Paddle named as reseller; plan changes covered; UK yearly renewals get 14 days. Admin refund now refunds every payment in the first 14 days.
- **Getting paid (C, 26 Nov 2026):** Paddle pays TactiCoach by **wire** to the business bank account.

## Not in this release

- Admin → Finance still reads Stripe only.
- Two paid checkout tabs make two Paddle subscriptions. This is flagged in Sentry for a manual refund; it is not blocked.
- No email statements to authors yet.
