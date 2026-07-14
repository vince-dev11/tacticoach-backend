// Transactional emails — branded templates over the SMTP mailer.
//
// Every sender here is safe to call unconditionally:
//   - when SMTP is not configured the email is skipped (and logged) so no
//     product flow ever depends on email delivery;
//   - failures are caught and logged, never thrown (a lost email must not
//     fail a signup or a Stripe webhook).

import { env } from '../config/env.js'
import { isMailConfigured, sendMail } from '../config/mailer.js'

const BRAND = '#00A76F'

function layout(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif">
    <span style="display:none;max-height:0;overflow:hidden">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
          <tr><td style="padding:0 24px 16px" align="center">
            <span style="font-size:22px;font-weight:800;color:${BRAND};letter-spacing:.3px">TactiCoach</span>
          </td></tr>
          <tr><td style="background:#ffffff;border-radius:12px;padding:32px 32px 28px;color:#1a2332;font-size:15px;line-height:1.6">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:18px 24px;color:#8a94a3;font-size:12px;line-height:1.5" align="center">
            TactiCoach — tactical boards, animations &amp; drill sheets for football coaches.<br>
            You're receiving this because you have a TactiCoach account.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 26px;border-radius:8px;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700">${label}</a></p>`

/** Send an email without ever throwing — logs and swallows failures. */
async function sendSafely(
  opts: { to: string; subject: string; html: string; text: string },
  logCtx: string,
): Promise<void> {
  if (!isMailConfigured()) {
    console.warn(`[emails] SMTP not configured — skipped ${logCtx} to ${opts.to}`)
    return
  }
  try {
    await sendMail(opts)
  } catch (err) {
    console.error(`[emails] Failed to send ${logCtx} to ${opts.to}`, err)
  }
}

// ---- Welcome (on register) ---------------------------------------------------

export async function sendWelcomeEmail(
  user: { name: string; email: string },
  verifyUrl?: string,
): Promise<void> {
  const dashboard = `${env.FRONTEND_URL}/dashboard`
  const verifyText = verifyUrl
    ? `\nPlease verify your email address:\n${verifyUrl}\n`
    : ''
  const verifyHtml = verifyUrl
    ? `<p style="margin:0 0 4px">Please verify your email address to secure your account:</p>
       ${button(verifyUrl, 'Verify my email')}
       <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${verifyUrl}</p>`
    : `${button(dashboard, 'Open your dashboard')}`
  await sendSafely(
    {
      to: user.email,
      subject: 'Welcome to TactiCoach — your 7-day free trial has started',
      text:
        `Hi ${user.name},\n\n` +
        `Welcome to TactiCoach! Your 7-day free trial with full access is now active.\n${verifyText}\n` +
        `During your trial you can:\n` +
        `- Build tactical boards on multiple pitch types\n` +
        `- Animate movements frame by frame and export video\n` +
        `- Create printable drill sheets\n\n` +
        `Get started: ${dashboard}\n\n` +
        `Happy coaching!\nThe TactiCoach team`,
      html: layout(
        'Your 7-day free trial with full access is now active.',
        `<h1 style="margin:0 0 12px;font-size:20px">Welcome, ${user.name}! 👋</h1>
         <p style="margin:0 0 12px">Your <strong>7-day free trial</strong> with full access is now active. During your trial you can:</p>
         <ul style="margin:0 0 16px;padding-left:20px">
           <li>Build tactical boards on multiple pitch types</li>
           <li>Animate movements frame by frame and export video</li>
           <li>Create printable drill sheets for your sessions</li>
         </ul>
         ${verifyHtml}
         <p style="margin:0;color:#6b7280;font-size:13px">Happy coaching!<br>The TactiCoach team</p>`,
      ),
    },
    'welcome email',
  )
}

// ---- Email verification (resend) -----------------------------------------------

export async function sendVerificationEmail(
  user: { name: string; email: string },
  verifyUrl: string,
): Promise<void> {
  await sendSafely(
    {
      to: user.email,
      subject: 'Verify your TactiCoach email address',
      text:
        `Hi ${user.name},\n\n` +
        `Confirm this email address for your TactiCoach account (link valid for 24 hours):\n${verifyUrl}\n\n` +
        `If you didn't request this, you can safely ignore this email.\n\n` +
        `The TactiCoach team`,
      html: layout(
        'Confirm your email address for TactiCoach.',
        `<h1 style="margin:0 0 12px;font-size:20px">Verify your email ✉️</h1>
         <p style="margin:0 0 4px">Hi ${user.name}, confirm this email address for your TactiCoach account (the link is valid for 24 hours):</p>
         ${button(verifyUrl, 'Verify my email')}
         <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${verifyUrl}</p>
         <p style="margin:0;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`,
      ),
    },
    'verification email',
  )
}

// ---- Trial reminder (2 days before expiry) ------------------------------------

export async function sendTrialReminderEmail(
  user: { name: string; email: string },
  expiresAt: Date,
): Promise<void> {
  const pricing = `${env.FRONTEND_URL}/#pricing`
  const daysLeft = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
  const dayWord = daysLeft === 1 ? 'day' : 'days'
  await sendSafely(
    {
      to: user.email,
      subject: `Your TactiCoach trial ends in ${daysLeft} ${dayWord}`,
      text:
        `Hi ${user.name},\n\n` +
        `Just a heads-up: your free trial ends in ${daysLeft} ${dayWord} (${expiresAt.toDateString()}).\n\n` +
        `Choose a plan to keep full access to the tactical editor, animations and drill sheets:\n${pricing}\n\n` +
        `If you let the trial lapse you can still sign in and browse, but the editor will be locked.\n\n` +
        `The TactiCoach team`,
      html: layout(
        `Your free trial ends in ${daysLeft} ${dayWord} — keep your editor access.`,
        `<h1 style="margin:0 0 12px;font-size:20px">Your trial ends in ${daysLeft} ${dayWord} ⏳</h1>
         <p style="margin:0 0 12px">Hi ${user.name}, just a heads-up: your free trial ends on <strong>${expiresAt.toDateString()}</strong>.</p>
         <p style="margin:0 0 4px">Choose a plan to keep full access to the tactical editor, animations and drill sheets.</p>
         ${button(pricing, 'See plans & pricing')}
         <p style="margin:0;color:#6b7280;font-size:13px">If the trial lapses you can still sign in and browse — the editor just locks until you upgrade.</p>`,
      ),
    },
    'trial reminder',
  )
}

// ---- Purchase confirmation (from the Stripe webhook) ---------------------------

export async function sendPurchaseEmail(
  user: { name: string; email: string },
  plan: { name: string },
  billingCycle: 'monthly' | 'annual',
  expiresAt: Date | null,
): Promise<void> {
  const dashboard = `${env.FRONTEND_URL}/dashboard`
  const renews = expiresAt ? ` Your subscription renews on ${expiresAt.toDateString()}.` : ''
  await sendSafely(
    {
      to: user.email,
      subject: `You're on TactiCoach ${plan.name} — thanks for subscribing!`,
      text:
        `Hi ${user.name},\n\n` +
        `Thanks for subscribing! Your ${plan.name} plan (billed ${billingCycle}) is now active.${renews}\n\n` +
        `Everything is unlocked — jump back in: ${dashboard}\n\n` +
        `A payment receipt is sent separately by Stripe.\n\n` +
        `The TactiCoach team`,
      html: layout(
        `Your ${plan.name} plan is active — everything is unlocked.`,
        `<h1 style="margin:0 0 12px;font-size:20px">You're on ${plan.name} 🎉</h1>
         <p style="margin:0 0 12px">Hi ${user.name}, thanks for subscribing! Your <strong>${plan.name}</strong> plan (billed ${billingCycle}) is now active.${renews}</p>
         ${button(dashboard, 'Open your dashboard')}
         <p style="margin:0;color:#6b7280;font-size:13px">A payment receipt is sent separately by Stripe. You can manage your plan any time from your profile.</p>`,
      ),
    },
    'purchase confirmation',
  )
}

// ---- Club invite ---------------------------------------------------------------

export async function sendClubInviteEmail(params: {
  to: string
  clubName: string
  inviterName: string
  acceptUrl: string
  expiresAt: Date
}): Promise<void> {
  const { to, clubName, inviterName, acceptUrl, expiresAt } = params
  await sendSafely(
    {
      to,
      subject: `${inviterName} invited you to join ${clubName} on TactiCoach`,
      text:
        `Hi,\n\n` +
        `${inviterName} invited you to join ${clubName} on TactiCoach — you'll get full access to the tactical editor through the club's plan.\n\n` +
        `Accept the invite (valid until ${expiresAt.toDateString()}):\n${acceptUrl}\n\n` +
        `You'll need a TactiCoach account with this email address — signing up is free.\n\n` +
        `The TactiCoach team`,
      html: layout(
        `${inviterName} invited you to join ${clubName} on TactiCoach.`,
        `<h1 style="margin:0 0 12px;font-size:20px">You're invited to ${clubName} ⚽</h1>
         <p style="margin:0 0 12px"><strong>${inviterName}</strong> invited you to join <strong>${clubName}</strong> on TactiCoach — you'll get full access to the tactical editor through the club's plan.</p>
         ${button(acceptUrl, 'Accept invite')}
         <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${acceptUrl}</p>
         <p style="margin:0;color:#6b7280;font-size:13px">The invite is valid until ${expiresAt.toDateString()}. You'll need a TactiCoach account with this email address — signing up is free.</p>`,
      ),
    },
    'club invite',
  )
}

// ---- Club page review results ---------------------------------------------------

export async function sendClubPageApprovedEmail(
  owner: { name: string; email: string },
  clubName: string,
  pageUrl: string,
): Promise<void> {
  await sendSafely(
    {
      to: owner.email,
      subject: `${clubName} is live on TactiCoach 🎉`,
      text:
        `Hi ${owner.name},\n\n` +
        `Great news — ${clubName}'s public page has been approved and is now live:\n${pageUrl}\n\n` +
        `Share it with your players, parents and socials. Everything you and your coaches publish appears there automatically.\n\n` +
        `The TactiCoach team`,
      html: layout(
        `${clubName}'s public page is approved and live.`,
        `<h1 style="margin:0 0 12px;font-size:20px">${clubName} is live 🎉</h1>
         <p style="margin:0 0 4px">Hi ${owner.name}, your club's public page has been approved:</p>
         ${button(pageUrl, 'View your club page')}
         <p style="margin:0;color:#6b7280;font-size:13px">Share it with players, parents and on your socials — everything your coaches publish appears there automatically.</p>`,
      ),
    },
    'club page approved',
  )
}

export async function sendClubPageRejectedEmail(
  owner: { name: string; email: string },
  clubName: string,
  note: string,
): Promise<void> {
  await sendSafely(
    {
      to: owner.email,
      subject: `About ${clubName}'s public page on TactiCoach`,
      text:
        `Hi ${owner.name},\n\n` +
        `We couldn't approve ${clubName}'s public page yet.\n\nReviewer note: ${note}\n\n` +
        `Update your branding or content and submit again — it only takes a minute.\n\n` +
        `The TactiCoach team`,
      html: layout(
        `We couldn't approve ${clubName}'s page yet.`,
        `<h1 style="margin:0 0 12px;font-size:20px">Almost there</h1>
         <p style="margin:0 0 10px">Hi ${owner.name}, we couldn't approve <strong>${clubName}</strong>'s public page yet.</p>
         <p style="margin:0 0 10px;padding:10px 14px;background:#f4f6f8;border-radius:8px;color:#1a2332"><strong>Reviewer note:</strong> ${note}</p>
         <p style="margin:0;color:#6b7280;font-size:13px">Update your branding or content and submit again — it only takes a minute.</p>`,
      ),
    },
    'club page rejected',
  )
}

// ---- Contact form → support inbox ----------------------------------------------

/**
 * Build the support-inbox notification for a contact-form submission. Unlike
 * the senders above, the caller sends this itself: contact delivery failures
 * SHOULD surface to the user (their message would otherwise vanish).
 */
export function buildContactEmail(input: {
  firstName: string
  lastName: string
  email: string
  message: string
}): { to: string; subject: string; html: string; text: string } {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    to: env.SUPPORT_EMAIL ?? env.MAIL_FROM,
    subject: `Contact form: ${input.firstName} ${input.lastName}`,
    text:
      `New contact form submission\n\n` +
      `From: ${input.firstName} ${input.lastName} <${input.email}>\n\n` +
      `${input.message}`,
    html: layout(
      'New contact form submission.',
      `<h1 style="margin:0 0 12px;font-size:18px">New contact form submission</h1>
       <p style="margin:0 0 12px"><strong>From:</strong> ${esc(input.firstName)} ${esc(input.lastName)} &lt;${esc(input.email)}&gt;</p>
       <p style="margin:0;white-space:pre-wrap">${esc(input.message)}</p>`,
    ),
  }
}
