# Deploy note: no throwaway emails, one account per inbox (25 Nov 2026)

## What it does

**Throwaway emails.** Sign-up (including a teenager's parent's email) and early-access requests refuse throwaway inboxes:

- for example yopmail, mailinator, 10minutemail and guerrillamail — 10,455 domains in all;
- the person sees a clear message in their language under the email box: "This looks like a temporary email address … please use an email you'll keep."

What is not affected:

- **Support messages** on the contact form are always accepted.
- **Real providers and privacy relays** are never blocked: Gmail, Outlook, iCloud, Apple "Hide My Email", Firefox Relay, DuckDuckGo, SimpleLogin and addy.io.

**One account per inbox.** A new sign-up whose inbox already has an account is refused. Gmail ignores dots and anything after "+", so `john.smith+2@gmail.com` is the same inbox as `johnsmith@gmail.com`. For other providers only the "+tag" is ignored.

**Existing accounts** are never checked, changed or locked out.

## Steps

1. `npx prisma migrate deploy` applies migration **71_email_inbox**:
   - it adds `users.email_inbox`;
   - it fills it in for existing accounts;
   - it adds an index.
2. `npx prisma generate`.
3. Deploy the API, then the web app.
4. `BLOCK_DISPOSABLE_EMAILS=true` is the default. Set it to `false` only in an emergency.

## Keeping the list fresh

About once a month, run `node scripts/update-disposable-domains.mjs` and commit the result. The source list is CC0, from github.com/disposable-email-domains.
