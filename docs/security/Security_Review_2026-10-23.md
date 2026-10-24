# Security review: 23 Oct 2026 (payments first)

**Scope:**

- **Both repos**, focused on payments.
- **Stripe:** checkout, webhooks, refunds, the 70/30 book split, referral and partner commission, and price handling.
- **The rest:** sign-in tokens, ownership on every `:id` route, the player and parent lockdown, secrets, uploads, unsafe HTML, and dependency audits.

**Method:** code read, plus automated scans (route ownership heuristic, secret patterns over the git history, `npm audit`), plus tests.

**Not covered:**

- server or nginx configuration;
- the live Stripe dashboard settings;
- an external penetration test.

## Summary

| Sev. | # | Finding | Status |
|---|---|---|---|
| **High** | P1 | Book sale recorded at today's price, not the amount actually paid | **Fixed** |
| **High** | D1 | `nodemailer` 9 has two published advisories (high) | **Fixed** (10.2.1) |
| Medium | P2 | Paying twice for one book (two tabs) kept both payments | **Fixed** (second one refunded) |
| Medium | P3 | Subscription end date missing on an older Stripe API version, which means never expires | **Fixed** |
| Medium | P4 | A plan upgrade takes effect before the difference is paid | **Your decision** |
| Medium | P5 | A refund made in the Stripe dashboard does not end the plan | **Your decision** |
| Low | D2 | `mariadb` moderate advisory | Accepted for now (not reachable) |
| Low | P6 | The Admin refund refunds the latest invoice only | Noted |
| Low | P7 | A partial Stripe refund takes the whole book back | Noted |

**Checked and sound:** see the end of this document.

---

## P1 · Book sale recorded at the wrong amount (High, fixed)

**Where:**

- `ebooks/purchases.service.ts` `markPaid`
- `webhooks/stripe.routes.ts`

**What happened:**

- **One row, reused:** each reader has one purchase row per book. Starting checkout again reuses the row at today's price and opens a new Stripe page.
- **Old pages stayed payable:** the earlier page stayed valid for 24 hours.
- **The webhook trusted the row:** it marked the row paid using the row's price.

**Exploit:**

1. The author sets £0.50, and a reader opens checkout.
2. The author changes the price to £20, and the reader opens checkout again. The row now says £20.
3. The reader pays the **first** page (£0.50).
4. The sale was recorded as £20, and the author was credited £14, while £0.50 came in.

It also works without the author's help whenever a price goes up.

**Fix:**

- The webhook passes Stripe's `amount_total` and `currency`.
- The sale and the 70/30 split are recorded on what was actually paid.
- A zero amount or another currency is never recorded; it is logged to Sentry.
- Starting a new checkout **closes the old unpaid page** (`checkout.sessions.expire`).

**Tests:** `tests/billing.test.ts` → "PAY-AMOUNT / PAY-TWICE / PAY-STALE".

## P2 · Two payments for one book (Medium, fixed)

Two open checkout tabs, both paid: the second webhook saw "already paid", returned, and kept the money.

**Now:** a second, different payment for a book already owned is refunded automatically and logged. A repeat delivery of the same payment changes nothing.

## P3 · Subscription period end (Medium, fixed)

`periodEnd()` read `items[0].current_period_end`, which is where Stripe API "basil" (2025+) keeps it.

- **The risk:** a webhook endpoint created on an older API version sends the date on the subscription instead. It was read as "no end date", and `subIsActive` treats an active plan with no end date as never expiring.
- **Now:** both places are read.
- **Also do in Stripe:** create the webhook endpoint on the current API version (see the deploy checklist).

## P4 · Upgrade before paying (Medium, your decision)

`POST /membership/checkout` for someone already paying moves them to the new plan with `proration_behavior: 'create_prorations'`.

- **What happens now:**
  - The plan switches at once.
  - The price difference is added to the **next** invoice.
  - A coach can upgrade to Club, use it for weeks, and downgrade before renewal. The net charge may come out lower than the use.
- **Option:** `proration_behavior: 'always_invoice'` with `payment_behavior: 'error_if_incomplete'`.
  - The difference is charged immediately.
  - If the card fails, the upgrade does not happen.
- **Recommended:** yes. It is the standard SaaS behaviour.
- **Status:** not changed without your OK, because it changes what customers are charged and when.

## P5 · A dashboard refund keeps the plan (Medium, your decision)

The Admin **Refund & end plan** button refunds, cancels the subscription and expires access. Correct.

A refund made directly in the Stripe dashboard only reverses referral and commission; the plan keeps running.

**Options:**

- **(a) A rule:** always refund subscriptions from Admin, never from the dashboard. No code change.
- **(b) Code:** a **full** refund of a subscription invoice also cancels the plan and expires access.

## D1 · nodemailer (High, fixed)

**Advisories:** GHSA for nodemailer ≤ 10.0.9:

- the SMTP TLS servername is reused across transports;
- nested recipient arrays can cause a DoS.

**Our exposure was low:** one SMTP transport, and recipients we control. Fixed anyway.

**Change:**

- `^9.1.1` → `^10.2.1`. It needs Node ≥ 20; the server is on Node 24.
- Only the nodemailer entry in `package-lock.json` changed.
- Tested against a local SMTP exchange with our transport settings: accepted.
- `npm audit --omit=dev` now reports **0** for the API.

## D2 · mariadb (Low, accepted)

**Advisory:** a client crash during **ed25519** authentication with zero-configuration TLS.

**Not reachable:** we use password authentication.

**Why not upgraded now:** 3.5.4 also moves `lru-cache` and `iconv-lite` under Prisma's pinned adapter. Upgrade together with the next Prisma adapter release (see the `//overrides` note in `package.json`).

## P6, P7 · Notes

- **P6:** Admin refund refunds the **latest** paid invoice. If a coach changed plan within the 14 days, the first payment is not the one refunded. This is rare, but refund the rest in Stripe if it happens.
- **P7:** a partial refund of a book in Stripe also takes the book back. That is fine if partial book refunds never happen.

## Checked and sound

**Payments**

- Prices come from the plans table and the book row, never from the browser.
- Checkout sessions are created only on the server, with server metadata.
- Webhook signatures are verified on the raw body; a bad signature gets 400.
- Every Stripe event is handled once (primary key on the event id). A failure forgets the event so Stripe retries.
- Referral credit and partner commission are earned only on a cleared invoice, the first one only. They are unique per invoice and reversed on refund.
- Book and plan checkout are refused for players, parents and minors (403 `ask_parent`).
- Test purchases are owner-only and never counted in author earnings.
- The success page only polls the server; it grants nothing itself.
- Card details never touch our pages (Stripe-hosted checkout), so we are out of PCI scope.

**Sign-in**

- Access and refresh secrets: at least 32 characters each, and they must differ.
- The auth guard rejects refresh and email-verification tokens.
- Refresh and reset tokens are stored as SHA-256 hashes.

**Access**

- All 89 `:id`/`:slug` routes outside Admin were checked. Every signed-in one scopes to the caller (for example the season plans: login for the whole plugin plus `userId` in every query).
- The flagged public ones are public by design: book, coach and club pages, blog, certificates, invite links.
- Paid chapters stay locked (`canReadAll`).

**Admin**

- Every route needs a login **and** the owner role, checked against the database on each request.

**Other**

- **Uploads:** size cap, allowed image types, no SVG.
- **HTML:** blog and article HTML goes through DOMPurify.
- **Secrets:** none in either repo or its git history; only placeholders and test strings.
- **Dependencies:** the frontend `npm audit` is clean.
- **Network:** CORS is an allow-list.

## Before switching Stripe to live

1. **Webhook endpoint:** create it on the **current** API version, with these events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `charge.refunded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
2. **Signing secret:** put the endpoint's own secret in `STRIPE_WEBHOOK_SECRET`. Live mode has its own.
3. **API key:** use a **restricted** key if you can. It needs Checkout, Customers, Subscriptions, Invoices, Refunds, Prices/Products and the Billing Portal.
4. **Test mode first, end to end:**
   - a plan purchase;
   - a cancellation;
   - an Admin refund;
   - a book purchase;
   - a book refund from the dashboard.
5. **Decide P4 and P5.**
