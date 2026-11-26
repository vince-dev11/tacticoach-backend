# Paddle: where we are, what's left, and how to build it — 25 Nov 2026

*Checked on 25 Nov 2026 in the Paddle dashboard (live account, read only: nothing was changed), on tacticoach.co.uk, and in both repos. This is not legal or tax advice; the tax and payout points are for your CA.*

---

## 1. Summary

Paddle is a **merchant of record (MoR)**: Paddle is the seller to the coach, so it charges the card, adds and pays the VAT/sales tax in every country, sends the invoice, handles refunds and chargebacks, and pays us the rest once a month. That removes the biggest problem in `TACTICAL_COACH/01_Legal/Selling_Worldwide_Guide_2026-10.md`: registering for UK VAT and EU VAT before the first sale.

**Where we are:**

- The live account exists: seller ID 485199, product website `https://tacticoach.co.uk/`.
- About 10% of the setup is done: the statement name, payment methods, the payout country (India) and the SaaS tax category.
- Nothing is built in the code yet. Today the code takes payments with Stripe only.

**Four things stop us going live, in this order:**

1. **Prices are hidden on the website.** It shows "Launching soon / Request early access". Paddle's domain review asks for *pricing details or a pricing page* (a screenshot is accepted if it isn't live yet).
2. **The book shop is a marketplace.** Coaches write books, we sell them and pay the author 70%. Paddle's Acceptable Use Policy (updated 13 Apr 2026) prohibits *"any product or service that enables non-Paddle Sellers to sell products and services to customers, such as digital marketplaces"*. Subscriptions are fine. Books need Paddle's written OK first (section 4, decision A).
3. **The refund policy doesn't match Paddle's.** Ours deducts the payment fee from refunds and gives no refund on renewals. Paddle makes the refunds itself and applies its own rules, for example a new 14-day right after each yearly renewal in the UK. Our policy has to be rewritten for Paddle (decision B).
4. **No sandbox account, no catalog, no webhook, no keys.** The integration has to be built and tested in a Paddle sandbox before the live account can take money.

---

## 2. What I checked in your Paddle account

| Area | What it shows now | What it needs | Who |
|---|---|---|---|
| Live / sandbox | Live account only. Sandbox login asks to sign up (no sandbox account yet). | A separate **sandbox account** (sandbox-vendors.paddle.com/signup) to build and test without real money. | You |
| Get started | 0 %: "Set up your live account", "Verify your account", "Test and go live" all *Not started*. | Done at the end of this list. | You + code |
| Account settings | Company legal name **"tacticoach"**; display name **not set**; website `https://tacticoach.co.uk/`; contact email `info@tacticoach.co.uk`. | The legal name must match your business documents **exactly** (the name on the partnership deed / GST registration). Paddle sets it: email **sellers@paddle.com** to change it, and to set the display name to **TactiCoach**. | You |
| Team members | One user (you), **two-factor authentication: Off**. | **Turn on 2FA now.** This account will receive all our revenue. *My account → Settings → User settings → Two-factor authentication*. | You |
| Catalog → Products | **No products.** | 5 products × 2 prices (section 5, step 3). | Code / you |
| Checkout → Payment methods | **Owner's choice (26 Nov 2026): card (always on) + PayPal, Apple Pay, Google Pay, Pix, MB WAY.** Bancontact off. Set and saved in the **sandbox**. | **Live:** set the same once the domain is approved — Paddle refuses to save checkout settings in live until a default payment link (on an approved domain) exists. | You / Claude |
| Checkout → Statement description | **TACTICOACH** ✓ (what coaches see on their bank statement) | Nothing. Good choice. | — |
| Checkout → Default payment link | **Empty.** | `https://tacticoach.co.uk/checkout` (a page that loads Paddle.js). It can only be set after the domain is approved. Without it Paddle can't open checkouts or send "update your card" emails. | Code, then you |
| Website approval | **No domain submitted.** | Submit `tacticoach.co.uk` once section 3 is done. | You |
| Hosted checkouts | "In live accounts, only available for an app-to-web funnel… Request access". | Not needed: we use the **overlay checkout on our own site** (Paddle.js). Stripe sent coaches to a Stripe page; Paddle opens over our page instead. | Code |
| Currencies → balance | **USD**, 0 active conversions. | Keep USD: Paddle doesn't pay out in INR, and Payoneer only pays USD. Prices stay in **GBP** for UK coaches (we set GBP prices on each product). | — |
| Taxable categories | **SaaS: Approved** ✓ · eBook: not requested · Standard digital goods: default. | SaaS covers the plans. Request **eBook** only if Paddle agrees to the books (decision A); UK VAT on e-books is 0%. | You |
| Events → Notifications | **No webhook destination.** | Create one for `https://api.tacticoach.co.uk/api/webhooks/paddle` (section 5, step 4). | You (after the code exists) |
| Payouts → Payout settings | Country **India** ✓; account type **not selected**; representative name and date of birth **empty**; method **Payoneer** (default); threshold **$100**. **Not saved.** | Account type: **Partnership / LLP** (if that is what the deed says). Representative: you. Choose **Wire (bank transfer)** — owner decision C, 26 Nov 2026 — enter the business bank details yourself, then save. | You |
| Customer portal | A portal link exists. | Our "Manage billing" button will open a portal session from the API (section 6). | Code |
| Authentication (API keys) | Not opened: I did not view the keys page. | Create keys in **sandbox** first. Never paste a key into chat or git. | You |

---

## 3. The website: what Paddle's reviewer must see

Paddle's domain review asks for these, reachable from the site's navigation:

- what the product is;
- prices;
- key features;
- Terms, Refund Policy and Privacy Policy;
- the business name in the Terms;
- a live HTTPS site.

Reviewers also check the product against the Acceptable Use Policy. The "Get started" page adds: a contact email or form reachable from the homepage, and **on-site prices that match the Paddle catalog**.

| Check | tacticoach.co.uk today | To do |
|---|---|---|
| Clear product description and features | ✓ Home page explains the board, video, drill sheets and session plans. | — |
| Prices / pricing page | ✗ Hidden ("Launching soon", `VITE_SHOW_PRICES` not set). | Build with **`VITE_SHOW_PRICES=true`** before submitting. Or, if you want prices hidden until launch, send Paddle a screenshot of the pricing section. |
| Terms, Privacy, Refund linked in nav/footer | ✓ Footer: Privacy, Terms, Refunds, Contact. | — |
| Business name in the Terms | ✓ "TactiCoach is provided by **TactiCoach**". | Must be the **same legal name** Paddle holds (see the Account settings row in section 2). |
| Contact email reachable from the home page | ✓ Contact link, but the email shown is **tacticoach.co.uk@gmail.com**. | Build with `VITE_CONTACT_EMAIL=info@tacticoach.co.uk`. A domain address looks like a real business. |
| Business address | Hidden until launch (`VITE_SHOW_ADDRESS`). | Paddle's list doesn't require it, but UK and EU online-selling rules do. Show it when you open sales. |
| Login-only parts | Sign-up is closed (early access). | Paddle may ask for a **test account** to see the product. Prepare one reviewer login (a normal coach account on a paid-feature trial). Give it to Paddle by email, not in the app. |
| The book shop | Books by coaches, 70% to the author. | See decision A: hide the shop (or the Buy buttons) from the reviewed site until Paddle agrees. |
| "Merchant of record" wording | ✓ Terms already say a reseller "named at checkout" handles payment, tax and invoice. | Name Paddle once it's live: *"Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders."* (Section 6, item 9.) |

---

## 4. Decisions for you (the owner)

**A. Books (the marketplace rule).** Paddle prohibits marketplaces. Three options:

1. **Recommended: ask Paddle first.** Email sellers@paddle.com before submitting the domain. Describe the books the way they work: TactiCoach publishes them in its own reader; authors licence the content to TactiCoach and get a 70% royalty; buyers buy from TactiCoach. Ask whether that is allowed. Paddle's review may ask for **product ownership** or **reseller agreement** documents. The author agreement would be that.
2. **Launch subscriptions only.** Keep the shop on "Buying opens soon" (`BOOK_SALES=false`). Turn books on later if Paddle agrees.
3. **Sell books elsewhere.** This means our own Stripe account, which brings back the VAT registrations Paddle is meant to remove. Not recommended.

**B. Refund policy.** With Paddle, refunds go through Paddle and follow its buyer refund policy. That policy keeps any stronger right from the law, gives UK annual subscribers a new 14 days after each renewal, and has EU withdrawal handled in Paddle's customer portal. Our policy deducts the processing fee and gives no refund on renewals. Recommendation:

- **Drop the fee deduction.** With Paddle we can't control it at Paddle's end, and it is the clause reviewers question.
- **Keep it simple:** a full refund within 14 days of the first payment; after that, cancel any time and keep access to the end of the period, with no refund; and any longer right under Paddle's policy or local law always applies.
- **Requests go to us or paddle.net.**

That is also what Terms §11 said before 19 Nov. Updating the Refund Policy page and Terms §11 is a copy change (section 6, item 9).

**C. How Paddle pays you.** The payout country is India.

- **Wire transfer in USD to the business's current account.** There is no Paddle fee when the currency matches the account; your bank's charges may apply. The bank can issue the **FIRC / e-FIRA** your CA needs to show the export for GST.
- **Payoneer.** USD only; Payoneer's own fees apply (published at up to about 3% plus a yearly fee); it pays out to an Indian bank in about 2 days.

Ask your CA which gives cleaner export paperwork. My default is a **wire to the partnership's own account**: the name matches the business Paddle verified.

**D. Prices with or without VAT.** For consumers in the UK and EU the price shown must include VAT. Recommendation: **prices include tax**, so £8.99 is what the coach pays. Paddle takes the VAT out of that, so we keep less (section 7). The other way round, the coach sees £8.99 + VAT at checkout. That is common for business software but a worse surprise for a volunteer coach.

**E. Stripe.** If no coach pays through Stripe today, switch completely: Paddle for plans (and books if allowed). Keep the Stripe code behind the provider switch until Paddle has run live for a month, then remove it. If someone does pay through Stripe, keep their subscription on Stripe until it ends; new purchases go to Paddle.

---

## 5. Setup in order (one checklist)

**Step 1 · Safety (5 min, you)**

- [ ] Turn on 2FA in the live account.
- [ ] Email sellers@paddle.com:
  - correct legal name;
  - display name "TactiCoach";
  - the books question (decision A).

**Step 2 · Sandbox (10 min, you)**

- [ ] Sign up at sandbox-vendors.paddle.com/signup (it's a separate account; use the same email).
- [ ] In the sandbox: *Settings → Authentication*:
  - create a **server API key** with these permissions:
    - products and prices: read;
    - customers, transactions, subscriptions: read and write;
    - adjustments: write;
    - customer portal sessions: write;
  - create a **client-side token** (starts `test_`).
- [ ] Put them on your machine only (the API `.env` and the frontend `.env.local`). Never in chat or git.

**Step 3 · Catalog (code can create it, or 15 min by hand)**

Five products, tax category **SaaS**, each with a monthly and an annual price in **GBP**. Optionally add EUR and USD prices as country overrides.

| Product | Monthly | Yearly |
|---|---|---|
| Basic | £4.99 | £45.00 |
| Pro | £8.99 | £79.00 |
| Club 5 | £24.99 | £250.00 |
| Club 10 | £39.99 | £400.00 |
| Club 20 | £69.99 | £700.00 |

- These are the prices in `prisma/plans.ts`, the ones the site shows. They must match on the site and in Paddle.
- **No trial on the Paddle price.** Our 14-day free trial stays inside TactiCoach (no card). Paddle's own card-less trials are still in early access and not needed.
- Put our plan slug in each price's custom data (`{"slug":"pro","cycle":"monthly"}`), so the webhook can map a Paddle price back to our plan.

**Step 4 · Webhook (after the code exists)**

- [ ] *Events → Notifications → New destination*: URL `https://api.tacticoach.co.uk/api/webhooks/paddle`.
- [ ] Events to send:
  - `transaction.completed`;
  - `transaction.payment_failed`;
  - `subscription.created`;
  - `subscription.updated`;
  - `subscription.canceled`;
  - `subscription.past_due`;
  - `adjustment.created`;
  - `adjustment.updated`.
- [ ] Copy the **endpoint secret key** to `PADDLE_WEBHOOK_SECRET` on the server.

**Step 5 · Test everything in the sandbox (section 8).**

**Step 6 · Website ready → submit the domain** (section 3), then complete **Verify your account**. Paddle says it takes about 10 minutes. Have ready:

- your personal details: date of birth and home address;
- business details: legal name and address, and government-issued registration documents as PDFs. For a partnership: the deed and the registration. Not utility bills or tax-ID cards;
- who owns 25% or more.

Domain review is often automatic. A manual review takes about 5–7 business days.

**Step 7 · Live.** Repeat step 2 (live keys start `live_`) and steps 3–4 in the live account.

- Set the **default payment link** to `https://tacticoach.co.uk/checkout`.
- Finish the payout settings: **wire** to the business bank account (decision C, 26 Nov 2026).
- Make **one real purchase on your own card**, check it end to end, then refund it from Admin.

---

## 6. What has to change in the code

The shape stays the same: the server decides the price; **the webhook is the only thing that grants or ends access**; the success page grants nothing. Card details never touch our pages. These are the payments-security rules, and they don't change.

| # | Change | Where |
|---|---|---|
| 1 | `config/paddle.ts`: the official `@paddle/paddle-node-sdk`, `PADDLE_API_KEY`, `PADDLE_ENV=sandbox\|production` (fail loudly if unset), `PADDLE_WEBHOOK_SECRET`. Add all to `.env.example`. | API |
| 2 | **Checkout**: `POST /membership/checkout` returns `{ provider:'paddle', priceId, customData:{userId,planId,cycle}, email }` instead of a Stripe URL. The price ID is looked up on the server from the plan slug, never taken from the browser. The minor and player/parent refusals stay. | API `membership.routes.ts` + frontend `lib/membership.ts` |
| 3 | **Paddle.js overlay** on a small `/checkout` page (also the default payment link): load from `cdn.paddle.com` only, initialise with the client token (`VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV`), open the overlay with the price, prefilled email and custom data, success → `/billing/success`. The success page keeps polling entitlements. | Frontend |
| 4 | **Webhook** `POST /api/webhooks/paddle`: verify `Paddle-Signature` (HMAC-SHA256 of `ts:rawBody`; accept any `h1` during secret rotation) on the **raw body**, answer 2xx within 5 seconds. Each event handled once (store the event ID, as `stripe_events` does). Events can arrive late or out of order, so write the subscription row from the event's own data. | API `webhooks/paddle.routes.ts` |
| 5 | **Access**: `subscription.created/updated` → plan, cycle, `expiresAt` = current period end. `canceled` → expired. `past_due` keeps access while Paddle retries. A scheduled cancel is **not** a cancel: access stays until the period ends (the same as today's `cancelled` + future `expiresAt`). | `membership.service.ts`, `entitlements.ts` (unchanged rules) |
| 6 | **Change plan** in place: `PATCH /subscriptions/{id}` with the new price and `proration_billing_mode` (open owner decision P4: charge now or at renewal). **Cancel**: `POST /subscriptions/{id}/cancel` with `effective_from: next_billing_period`. | `membership.routes.ts` |
| 7 | **Manage billing** button → create a **customer portal session** for the signed-in coach's own Paddle customer ID (looked up on the server, never sent by the browser). | `/membership/portal` |
| 8 | **Refunds**: Admin "Refund & end plan" creates a Paddle **adjustment** (`action: refund`). Paddle approves most refunds first (`pending_approval`), so access ends and the referral and commission are reversed only when `adjustment.updated` says **approved**. Chargebacks arrive as adjustments too. | `admin.routes.ts`, webhook |
| 9 | **Copy**: Refund Policy and Terms §11 (decision B); name Paddle as merchant of record; Privacy Policy processor row "Stripe, or a reseller" → "Paddle". 7 locales where the pages are translated. | Frontend legal pages |
| 10 | **CSP** in `nginx.conf`: allow Paddle.js and its checkout frame. Today `script-src` and `frame-src` would block it. Add `https://cdn.paddle.com` to `script-src`, and Paddle's checkout domains to `frame-src`, and confirm the exact list in the sandbox (the browser console names any blocked domain). | Frontend `nginx.conf` |
| 11 | **Books** (only if decision A is yes): `payment-provider.ts` already has the `BookCheckoutProvider` interface for this. Add `paddleBookCheckout`: a one-off price created per purchase at the book's `price_pence`; `markPaid` on `transaction.completed` with the **amount actually paid**; the 70/30 split on that amount. | `ebooks/payment-provider.ts` |
| 12 | **Referral "free months"**: today they come off the next Stripe invoice. With Paddle, they move the subscription's next billed date or apply a credit. This needs a small design note before building. | `referral-credit.service.ts` |
| 13 | **Admin finance** (P&L, Stripe sync) reads Stripe today. Point it at Paddle's transactions and payouts reports (`retained_fee` shows what Paddle keeps on refunds and chargebacks). | `admin/finance/*` |
| 14 | DB: `paymentProvider` is already a free-text column (`'paddle'` fits); add `paddleCustomerId` on users and a processed-events table. **One migration.** | Prisma |

Size: a **level-3 change**. Write the football-product-expert brief first, then the payments-security checklist, then live Playwright specs for the pay → access → cancel → refund journey (sandbox).

---

## 7. What it costs (worked example)

Paddle: **5% + 50¢ per checkout transaction**. No monthly fee. Payments, tax filing, fraud checks and buyer billing support are included. For products under $10, Paddle says to **contact them for bespoke pricing**. Ask: our Basic monthly plan is £4.99.

With prices **including** UK VAT (20%), and 50¢ ≈ 39p:

| Plan | Coach pays | UK VAT (Paddle pays it) | Paddle fee | We receive | Fee as % of price |
|---|---|---|---|---|---|
| Basic monthly | £4.99 | £0.83 | £0.64 | **£3.52** | 12.8% |
| Pro monthly | £8.99 | £1.50 | £0.84 | **£6.65** | 9.3% |
| Club 5 monthly | £24.99 | £4.16 | £1.64 | **£19.19** | 6.6% |
| Basic yearly | £45.00 | £7.50 | £2.64 | **£34.86** | 5.9% |
| Pro yearly | £79.00 | £13.17 | £4.34 | **£61.49** | 5.5% |
| Club 5 yearly | £250.00 | £41.67 | £12.89 | **£195.44** | 5.2% |

*Assumptions to check in the sandbox:*

- the fee is worked out on the full amount the coach pays;
- 1 USD ≈ £0.78;
- a bank or Payoneer charge may come off the payout.

The fixed 50¢ hurts the cheap monthly plans most. Yearly plans lose about 5–6%, monthly Basic about 13%.

---

## 8. Sandbox test plan (before the live switch)

Use the test card `4242 4242 4242 4242`, any name, any future date, CVV `100`. For a decline: `4000 0000 0000 0002`.

1. A coach on the trial buys **Pro monthly**:
   - the overlay shows £8.99;
   - the webhook arrives and returns 2xx;
   - entitlements show Pro;
   - the success page unlocks without a reload.
2. The same webhook is delivered **twice**: nothing doubles.
3. **Declined card**: no access; the coach sees the error in the overlay.
4. **Upgrade Pro → Club 5** in place: still **one** subscription; the plan changes.
5. **Cancel**: access stays until the period end; the status is cancelled; no renewal.
6. **Refund within 14 days** from Admin:
   - pending → approved;
   - access ends;
   - the referral credit is reversed.
7. **Past due**: in Paddle's simulator, access stays during retries and ends at cancel.
8. A **player or parent account** or a **minor** calls checkout → 403 from the API (not just a hidden button).
9. **Forged webhook** (wrong signature) → rejected, nothing changes.
10. CSP: no blocked Paddle requests in the browser console, on Chrome and **Safari on iPad**.
11. Books, if allowed:
    - pay once;
    - pay a second time for a book already owned → automatically refunded;
    - an old checkout tab can't be paid at an old price.

---

## 9. Which services to use

| Need | Use | Why |
|---|---|---|
| Plans: checkout, subscriptions, VAT, invoices, refunds | **Paddle Billing** (overlay checkout + API + webhooks) | MoR: no VAT registrations for us; buyer billing support included. |
| Coaches manage their card, invoices, cancel | **Paddle customer portal** | Hosted by Paddle; also has the EU "withdraw" button the new EU rule asks for. |
| Building and testing | **Paddle sandbox** (+ the webhook simulator) | No real money, no verification. |
| Getting paid | **Wire to the business bank account (USD)** | Decided 26 Nov 2026 (C). Ask the CA about receiving USD (FIRC / purpose code). |
| Paying authors (if books) and referral partners | **Not Paddle**: our bank transfer, with TDS / 15CA-CB per the CA | Paddle pays only us. |
| Email | **Brevo** (already set up) | Unchanged. Paddle sends its own receipts. |
| Stripe | Keep the code switched off; remove after a month on Paddle | Decision E. |
| Not needed with Paddle | Stripe Tax, a VAT registration service, an invoicing tool | Paddle covers them. |

Still needed whoever takes the money (from the worldwide-selling guide):

- the CA: GSTIN, the LUT for zero-rated exports, FIRC/e-FIRA for each payout, TDS on author and partner payouts;
- an email reminder before yearly renewals;
- the privacy items for children's data.

---

## Sources

- [Paddle: Domain Review requirements](https://www.paddle.com/help/start/account-verification/what-is-domain-verification)
- [Paddle: Acceptable Use Policy, what you can't sell (updated 13 Apr 2026)](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)
- [Paddle: supported countries (India is supported)](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)
- [Paddle: pricing, 5% + 50¢](https://www.paddle.com/pricing)
- [Paddle: buyer refund policy (31 Mar 2026)](https://www.paddle.com/legal/refund-policy)
- [Paddle developer docs: go-live checklist](https://developer.paddle.com/build/go-live-checklist.md)
- [Paddle developer docs: webhook signature verification](https://developer.paddle.com/webhooks/about/signature-verification)
- [Paddle developer docs: refunds and credits (adjustments)](https://developer.paddle.com/build/transactions/create-transaction-adjustments)
- [Paddle developer docs: cardless trials (early access)](https://developer.paddle.com/build/trials/cardless-trials)
- [Paddle: business verification documents](https://www.paddle.com/help/start/account-verification/what-is-business-verification)
- [Paddle: is there a fee taken for payouts](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts)
- [Paddle.js wrapper: load only from cdn.paddle.com](https://github.com/paddlehq/paddle-js-wrapper)
- [Payoneer India pricing](https://www.payoneer.com/en-in/about/pricing/)
