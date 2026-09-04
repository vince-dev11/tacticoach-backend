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
  const site = env.FRONTEND_URL
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0c1120;font-family:Arial,Helvetica,sans-serif">
    <span style="display:none;max-height:0;overflow:hidden">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c1120;padding:28px 0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

          <!-- Header: logo (hosted; alt text shows when images are blocked) -->
          <tr><td style="padding:0 24px 18px" align="center">
            <a href="${site}" style="text-decoration:none">
              <img src="${site}/email/logo.png" width="200" alt="TactiCoach" style="display:block;border:0;max-width:200px;height:auto">
            </a>
          </td></tr>

          <!-- Pitch stripe bar (mown-grass motif) -->
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px 12px 0 0;overflow:hidden">
              <tr>
                <td height="7" width="20%" style="background:#0d6b2c"></td>
                <td height="7" width="20%" style="background:#0b5c24"></td>
                <td height="7" width="20%" style="background:#0d6b2c"></td>
                <td height="7" width="20%" style="background:#0b5c24"></td>
                <td height="7" width="20%" style="background:#0d6b2c"></td>
              </tr>
            </table>
          </td></tr>

          <!-- Body card -->
          <tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:34px 34px 30px;color:#1a2332;font-size:15px;line-height:1.65">
            ${bodyHtml}
          </td></tr>

          <!-- Footer -->
          <tr><td style="padding:20px 24px 6px" align="center">
            <a href="${site}" style="color:#34e0a1;text-decoration:none;font-size:12px;font-weight:700">tacticoach.co.uk</a>
            <span style="color:#3a4556;font-size:12px">&nbsp;&#183;&nbsp;</span>
            <a href="${site}/blog" style="color:#8a94a3;text-decoration:none;font-size:12px">Blog</a>
            <span style="color:#3a4556;font-size:12px">&nbsp;&#183;&nbsp;</span>
            <a href="${site}/contact" style="color:#8a94a3;text-decoration:none;font-size:12px">Contact</a>
          </td></tr>
          <tr><td style="padding:8px 24px 4px;color:#5b6577;font-size:11px;line-height:1.6" align="center">
            TactiCoach — tactical boards, animations &amp; drill sheets for football coaches.<br>
            You&#39;re receiving this because you have a TactiCoach account.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr>
     <td style="border-radius:9px;background:${BRAND};border-bottom:3px solid #067A52">
       <a href="${href}" style="display:inline-block;padding:13px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;font-family:Arial">${label}&nbsp;&nbsp;&#8594;</a>
     </td>
   </tr></table>`

/** Small pill kicker above a heading — "TRIAL", "CLUB INVITE", etc. */
const kicker = (label: string) =>
  `<div style="display:inline-block;padding:4px 12px;border-radius:999px;background:#E6F7F0;color:#067A52;font-size:10.5px;font-weight:800;letter-spacing:.12em;margin:0 0 12px">${label}</div>`

/** Green "pitch card" panel — the creative block inside richer emails. */
const pitchCard = (title: string, innerHtml: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr>
     <td style="background:#0d6b2c;border-radius:10px;padding:18px 20px;color:#ffffff">
       <div style="font-size:12px;letter-spacing:.1em;font-weight:800;color:#9fe8c8">${title}</div>
       <div style="margin-top:8px;font-size:14px;line-height:1.85">${innerHtml}</div>
     </td>
   </tr></table>`

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
        `${kicker("WELCOME TO THE SQUAD")}
         <h1 style="margin:0 0 12px;font-size:21px">You are on the team sheet, ${user.name} ✅</h1>
         <p style="margin:0 0 12px">Your <strong>7-day free trial</strong> with full access is now active. Here is the game plan:</p>
         ${pitchCard('YOUR KICK-OFF PLAN', `1&#65039;&#8419; One click puts a full team on the board &#8212; add your squad and it is YOUR players, by name<br>2&#65039;&#8419; Drag the runs &#8212; every movement becomes an animation, with your coaching notes on screen<br>3&#65039;&#8419; Export HD video straight to the team group chat`)}
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
        `${kicker("ONE QUICK CHECK")}
         <h1 style="margin:0 0 12px;font-size:21px">Verify your email ✉️</h1>
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
        `${kicker("FULL-TIME APPROACHING")}
         <h1 style="margin:0 0 12px;font-size:21px">⏳ ${daysLeft} ${dayWord} left on the clock</h1>
         <p style="margin:0 0 12px">Hi ${user.name}, just a heads-up: your free trial ends on <strong>${expiresAt.toDateString()}</strong>.</p>
         ${pitchCard('KEEP YOUR FULL ACCESS', `&#9989; The tactics board and animations<br>&#9989; HD video and social exports<br>&#9989; Drill sheets and the session planner<br>&#9989; Every board you have already saved`)}
         <p style="margin:0 0 4px">Plans start at &#163;2.99/month &#8212; yearly saves 33%.</p>
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
        `${kicker("SUBSCRIPTION CONFIRMED")}
         <h1 style="margin:0 0 12px;font-size:21px">You&#39;re on ${plan.name} 🎉</h1>
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
        `${kicker("CLUB INVITE")}
         <h1 style="margin:0 0 12px;font-size:21px">You&#39;re invited to ${clubName} ⚽</h1>
         <p style="margin:0 0 12px"><strong>${inviterName}</strong> invited you to join <strong>${clubName}</strong> on TactiCoach.</p>
         ${pitchCard('YOUR SEAT INCLUDES', `&#9989; Full tactics board and animations<br>&#9989; The club&#39;s shared tactic library<br>&#9989; Drill sheets and session plans<br>&#9989; No cost to you &#8212; covered by the club&#39;s plan`)}
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
        `${kicker("PAGE APPROVED")}
         <h1 style="margin:0 0 12px;font-size:21px">${clubName} is live 🎉</h1>
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
        `${kicker("ONE MORE TOUCH")}
         <h1 style="margin:0 0 12px;font-size:21px">Almost there</h1>
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

// ---- Password reset -------------------------------------------------------------

/**
 * Branded password-reset email. Found in pre-launch review: this was the one
 * flow still sending a bare unstyled HTML string from the route.
 */
export async function sendPasswordResetEmail(
  user: { name: string; email: string },
  resetUrl: string,
): Promise<void> {
  await sendSafely(
    {
      to: user.email,
      subject: 'Reset your TactiCoach password',
      text:
        `Hi ${user.name},\n\n` +
        `Reset your password using this link (valid for 1 hour):\n${resetUrl}\n\n` +
        `If you didn't request this, you can safely ignore this email.\n\n` +
        `The TactiCoach team`,
      html: layout(
        'Reset your TactiCoach password — the link is valid for 1 hour.',
        `${kicker('ACCOUNT SECURITY')}
         <h1 style="margin:0 0 12px;font-size:21px">Reset your password 🔐</h1>
         <p style="margin:0 0 4px">Hi ${user.name}, use the button below to choose a new password (the link is valid for 1 hour):</p>
         ${button(resetUrl, 'Reset password')}
         <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${resetUrl}</p>
         <p style="margin:0;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email — your password stays unchanged.</p>`,
      ),
    },
    'password reset',
  )
}
