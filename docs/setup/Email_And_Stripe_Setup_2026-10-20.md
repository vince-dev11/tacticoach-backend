# Setup guide: email from your own domain (free) and Stripe (keys only) — 20 Oct 2026

Everything below is configuration. The code is done (`Deploy_Billing_Onboarding_Email_2026-10-20.md`). After each part, **Admin → Overview → "Payments & email"** shows a green tick for each step that is working.

---

## Part 1 · Email from @tacticoach.co.uk, free (Brevo)

**Why Brevo:**
- Free for 300 emails a day (about 9,000 a month). Our volume is about 100 a month.
- Plain SMTP, so nothing changes in the code.
- It reports bounces, blocks and spam complaints to our webhook.

Your Gmail address keeps working as an inbox. It just stops being the *sender*.

> Check one thing when you sign up: some third-party reviews say the free plan adds Brevo branding in the footer. If our emails show it and you don't want it, the alternative is **Amazon SES**: about $0.10 per 1,000 emails, on the AWS account you already have. Same SMTP settings, different host and keys. With SES the bounce webhook isn't connected (bounces still show as failed when SES refuses a send).

### 1. Create the account (about 5 minutes)

1. Sign up at brevo.com with the team address. Choose the free plan.
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain:** `tacticoach.co.uk`.

### 2. Prove you own the domain (DNS, about 10 minutes, then wait)

Brevo shows 3–4 records to add **where tacticoach.co.uk's DNS is managed** (your registrar, or Cloudflare/Route 53 if you moved it):

| Type | Name | What it's for |
|---|---|---|
| TXT | `@` (or as shown) | `brevo-code:…`: proves you own the domain |
| TXT or CNAME | `mail._domainkey` (as shown) | **DKIM**: signs our emails |
| TXT | `_dmarc` | **DMARC**. Start with `v=DMARC1; p=none; rua=mailto:YOUR-INBOX` |
| TXT | `@` | **SPF**. If you already have an SPF record, **add** `include:spf.brevo.com` to it. Never keep two SPF records. |

Press **Authenticate** in Brevo. It can take minutes to a few hours. Brevo shows green ticks when it's done.

Google and Yahoo now require SPF, DKIM and DMARC aligned with the sender's domain. A Gmail address can't meet that for tacticoach.co.uk. That is the main reason recent invitations went unopened.

### 3. Create the sender

**Senders → Add a sender:**
- `no-reply@tacticoach.co.uk`, name "TactiCoach".
- `info@tacticoach.co.uk` too, for the personal welcome. Replies to it should reach a real inbox: set up forwarding to Gmail at your domain host, or use Gmail's "Send mail as".

### 4. Get the SMTP key

**SMTP & API → SMTP:** copy the **SMTP login** and **Generate a new SMTP key**. It must be the SMTP key, not the API key.

### 5. Put it on the server (API `.env`), then restart

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<the SMTP login>
SMTP_PASS=<the SMTP key>
MAIL_FROM="TactiCoach <no-reply@tacticoach.co.uk>"
TEAM_MAIL_FROM="TactiCoach <info@tacticoach.co.uk>"
SUPPORT_EMAIL=info@tacticoach.co.uk
EMAIL_WEBHOOK_TOKEN=<any long random string>
```

```
cd /var/www/html/tacticoach-backend && pm2 restart tacticoach-api --update-env
```

Don't paste keys into chat or commit them to git.

### 6. Connect bounces (2 minutes)

**Brevo → Transactional → Settings → Webhooks → Add a webhook:**
- URL: `https://tacticoach.co.uk/api/webhooks/email?token=<the EMAIL_WEBHOOK_TOKEN value>`
- Events: Hard bounce, Soft bounce, Blocked, Invalid email, Spam, Error.

A bounced email now shows as **"last email failed"** in Admin → Users, with the reason.

### 7. Test

1. Admin → Users → your own test account → ⋯ → **Set-password link**. It should arrive from `no-reply@tacticoach.co.uk`, not in spam.
2. Gmail → ⋯ → **Show original** should say `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
3. Admin → Users → **Resend to everyone waiting (N)**: the invited coaches get a fresh link in their own language.

---

## Part 2 · Stripe: only the keys

Products, prices (from our plans table), the billing portal and book checkout are all created by the API the first time they're needed. You don't create anything in the Stripe dashboard except the webhook.

### 1. Test mode first

1. Stripe dashboard → turn on **Test mode**.
2. **Developers → API keys:** copy the **Secret key** (`sk_test_…`).
3. **Developers → Webhooks → Add endpoint:**
   - URL: `https://tacticoach.co.uk/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.payment_succeeded`, `charge.refunded`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_…`).
4. API `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```
   Restart: `pm2 restart tacticoach-api --update-env`. The API log says `💳 Billing: Stripe on (test mode)`.
5. Admin → Overview shows **Stripe — connected (test mode)** and **Stripe webhook — secret set**.

### 2. Test the whole journey (card `4242 4242 4242 4242`, any future date, any CVC)

| Test | Expected |
|---|---|
| A coach: pricing → Basic monthly → pay | Back on "You're in"; Profile → Plan & billing shows "Basic. Renews on …"; a receipt email |
| Same coach: pricing → Pro | **No second checkout**: moved to Pro on the same subscription (prorated); Plan & billing says Pro |
| Plan & billing → **Manage billing** | Stripe's page: card, invoices, cancel |
| Cancel there | Plan & billing says "Pro is cancelled. You keep it until …"; the editor still works until then |
| Admin → Users → ⋯ → **Refund & end plan…** (within 14 days) | Refund appears in Stripe; the plan ends now |
| A book with a price → Buy | Stripe checkout → paid → the book opens; the author's 70% is recorded in Orders |
| Admin → Book orders → Refund | Money back in Stripe; access stops |

### 3. Go live

Repeat 1.2–1.4 with **live** keys (`sk_live_…`) and a **live** webhook endpoint (live mode has its own signing secret). Admin → Overview then says **live mode**.

Before taking real money:
- **VAT:** TactiCoach does not add tax at checkout today. If you are VAT-registered, or selling into the EU/UK above the thresholds, decide with your accountant whether to turn on Stripe Tax. That is a separate switch and not part of this change.
- **Payouts:** Stripe → Settings → Bank accounts.
- **Refund rule** (Terms §11): full refund on request within 14 days of the first payment. The Admin button follows that rule and asks before going outside it.

### Kill switch for the shop

`BOOK_SALES=false` in the API `.env` closes book buying ("Buying opens soon") while subscriptions keep working.
