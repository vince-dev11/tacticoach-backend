// Transactional emails — branded templates over the SMTP mailer.
//
// Every sender here is safe to call unconditionally:
//   - when SMTP is not configured the email is skipped (and logged) so no
//     product flow ever depends on email delivery;
//   - failures are caught and logged, never thrown (a lost email must not
//     fail a signup or a Stripe webhook).

import { env } from '../config/env.js'
import { isMailConfigured, sendMail } from '../config/mailer.js'
import { tagLabel } from './feedback-tag-labels.js'
import {
  DEFAULT_COACH_RATE,
  DEFAULT_CLUB_RATE,
} from '../modules/collaborations/collaboration-terms.js'
import { captureError } from './observability.js'

const BRAND = '#00A76F'

/**
 * Escape text that a USER wrote before it goes into an email body.
 *
 * Was local to buildContactEmail, which was the wrong place for it to be the
 * only copy: the contact form is the one template whose text nobody but us
 * reads. The player note carries a coach's free-typed sentence to a child and
 * their parent, and a stray "<" there breaks the layout at best.
 *
 * Quotes are left alone deliberately — nothing here interpolates into an
 * attribute, and escaping them would put &#39; in front of a reader the moment
 * a coach writes "don't".
 */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function layout(preheader: string, bodyHtml: string): string {
  const site = env.FRONTEND_URL
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0c1120;font-family:Arial,Helvetica,sans-serif">
    <span style="display:none;max-height:0;overflow:hidden">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c1120;padding:28px 0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

          <!-- Header: logo (hosted; alt text shows when images are blocked).
               The PNG is FLATTENED onto #0c1120 — no alpha channel. A
               transparent logo let Gmail's dark mode composite it onto a pale
               backdrop of its own choosing, and the white half of the wordmark
               disappeared into it. With no transparency there is nothing for a
               client to decide. The cell carries the same colour so the seam
               is invisible if images are slow to load.
               Served at 400px and displayed at 200 for phone screens. -->
          <tr><td style="padding:0 24px 18px;background:#0c1120" align="center">
            <a href="${site}" style="text-decoration:none">
              <img src="${site}/email/logo.png" width="200" alt="TactiCoach" style="display:block;border:0;width:200px;max-width:200px;height:auto;background:#0c1120">
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

/** Every template this module can send. Recorded against each email_log row. */
export type EmailKind =
  | 'welcome'
  | 'verification'
  | 'trial_reminder'
  | 'purchase'
  | 'club_invite'
  | 'club_page_approved'
  | 'club_page_rejected'
  | 'collaboration_invite'
  | 'account_setup'
  | 'player_note'
  | 'password_reset'
  | 'coach_contact'

/**
 * Send an email without ever throwing — logs and swallows failures.
 *
 * The "is SMTP configured" check that used to live here has moved into
 * sendMail. It returned early, so a skipped email left no trace at all: the
 * one case where somebody is definitely waiting for a link that is never
 * coming was the one case with no record of it.
 */
async function sendSafely(
  opts: { to: string; subject: string; html: string; text: string },
  kind: EmailKind,
  meta: { userId?: number; actorId?: number } = {},
): Promise<void> {
  try {
    await sendMail({ ...opts, kind, ...meta })
  } catch (err) {
    console.error(`[emails] Failed to send ${kind} to ${opts.to}`, err)
    // The recipient's address stays in the local log only; Sentry gets the
    // email kind and the account ID, which is enough to find it.
    captureError(err, { source: 'email', tags: { email_kind: kind }, extra: { userId: meta.userId } })
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
    'welcome',
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
    'verification',
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
    'trial_reminder',
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
    'purchase',
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
    'club_invite',
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
    'club_page_approved',
  )
}

/**
 * Collaboration invitation. Deliberately says "read and accept" rather than
 * "you are now a collaborator": nothing is comped and no commission accrues
 * until they accept the agreement in the app, and an email that implies
 * otherwise creates an expectation the product will then contradict.
 *
 * The rates are INTERPOLATED from the constants, never typed. This email said
 * a flat 20% for a while after the programme had moved to 15%, which is
 * exactly the failure the agreement's own tests exist to prevent — and an
 * email is worse than a contract for it, because nobody ever re-reads one.
 */
export async function sendCollaborationInviteEmail(
  invitee: { name: string; email: string },
  acceptUrl: string,
): Promise<void> {
  const coachPct = Math.round(DEFAULT_COACH_RATE * 100)
  const clubPct = Math.round(DEFAULT_CLUB_RATE * 100)
  await sendSafely(
    {
      to: invitee.email,
      subject: 'An invitation to the TactiCoach Collaboration Programme',
      text:
        `Hi ${invitee.name},\n\n` +
        `We'd like to invite you onto the TactiCoach Collaboration Programme.\n\n` +
        `Collaborators earn ${coachPct}% of what every coach they introduce pays and ${clubPct}% of what every club pays, on that customer's first payment — plus a TactiCoach Pro account free for as long as the collaboration runs.\n\n` +
        `The agreement is waiting in your account. Have a read, and if you're happy with it, accept it there:\n${acceptUrl}\n\n` +
        `Nothing starts until you accept, and there's no obligation to.\n\n` +
        `The TactiCoach team`,
      html: layout(
        'An invitation to the TactiCoach Collaboration Programme.',
        `${kicker('COLLABORATION INVITATION')}
         <h1 style="margin:0 0 12px;font-size:21px">We'd like you as a TactiCoach Collaborator</h1>
         <p style="margin:0 0 10px">Hi ${invitee.name}, collaborators earn <strong>${coachPct}%</strong> of what every coach they introduce pays and <strong>${clubPct}%</strong> of what every club pays, on that customer's first payment — plus a TactiCoach Pro account free for as long as the collaboration runs.</p>
         <p style="margin:0 0 4px">The agreement is waiting in your account:</p>
         ${button(acceptUrl, 'Read and accept the agreement')}
         <p style="margin:0;color:#6b7280;font-size:13px">Nothing starts until you accept, and there's no obligation to.</p>`,
      ),
    },
    'collaboration_invite',
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
    'club_page_rejected',
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

/**
 * A visitor's message relayed from a coach's public page. Reply-To is the
 * visitor, so the coach answers with one click and we are out of the loop;
 * the coach's own address is never shown on the page.
 */
export function buildCoachContactEmail(input: {
  to: string
  coachName: string
  name: string
  email: string
  message: string
}): { to: string; replyTo: string; subject: string; html: string; text: string } {
  return {
    to: input.to,
    replyTo: input.email,
    subject: `New message from ${input.name} via your TactiCoach page`,
    text:
      `Hi ${input.coachName},\n\n${input.name} <${input.email}> sent you a message from your coach page:\n\n` +
      `${input.message}\n\nReply to this email to answer them.`,
    html: layout(
      `New message from ${input.name}.`,
      `<h1 style="margin:0 0 12px;font-size:18px">New message from your coach page</h1>
       <p style="margin:0 0 12px"><strong>From:</strong> ${esc(input.name)} &lt;${esc(input.email)}&gt;</p>
       <p style="margin:0 0 16px;white-space:pre-wrap">${esc(input.message)}</p>
       <p style="margin:0;color:#64748b;font-size:13px">Reply to this email to answer them.</p>`,
    ),
  }
}

// ---- Password reset -------------------------------------------------------------

/**
 * Branded password-reset email. Found in pre-launch review: this was the one
 * flow still sending a bare unstyled HTML string from the route.
 */
/**
 * "Your account is ready" — for an account created by an admin rather than by
 * the person themselves. Deliberately not the reset email: someone who never
 * asked for anything needs to be told who made the account and why, or the
 * mail reads as a phishing attempt.
 */
export async function sendAccountSetupEmail(
  user: { id?: number; name: string; email: string },
  setupUrl: string,
  actorId?: number,
): Promise<void> {
  await sendSafely(
    {
      to: user.email,
      subject: 'Your TactiCoach account is ready',
      text:
        `Hi ${user.name},\n\n` +
        `An account has been created for you on TactiCoach.\n\n` +
        `Choose your password to get started (link valid for 7 days):\n${setupUrl}\n\n` +
        `If you weren't expecting this, you can ignore this email — the account cannot be used until a password is set.\n\n` +
        `— TactiCoach`,
      html: layout(
        'Your TactiCoach account is ready — choose a password to get started.',
        `${kicker('YOUR ACCOUNT')}
         <h1 style="margin:0 0 12px;font-size:21px">Your account is ready ⚽</h1>
         <p style="margin:0 0 4px">Hi ${user.name}, an account has been created for you on TactiCoach. Choose your password to get started (the link is valid for 7 days):</p>
         ${button(setupUrl, 'Choose your password')}
         <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${setupUrl}</p>
         <p style="margin:0;color:#6b7280;font-size:13px">If you weren't expecting this, you can ignore this email — the account cannot be used until a password is set.</p>`,
      ),
    },
    'account_setup',
    { userId: user.id, actorId },
  )
}

/**
 * "Your coach left you a note."
 *
 * Copied to the guardian when one is set, with a read-only link to the whole
 * log — transparency is the safeguarding expectation for adult-to-child
 * communication, and a parent who reads this every week is a parent who tells
 * the club to renew.
 *
 * The note body is deliberately included in full. A "you have a new message,
 * log in to read it" email is a notification nobody opens twice.
 */
export interface PlayerNoteEmail {
  to: string
  cc: string | null
  playerName: string
  coachName: string
  clubName: string | null
  body: string
  strengths: string[]
  workOns: string[]
  session: { title: string; date: Date | null } | null
  /** Notes so far with this coach, and what they keep coming back to. */
  digest: { total: number; strengths: [string, number][]; workOns: [string, number][] }
  /** An animated board the coach attached to this note, if any. */
  boardId: number | null
  guardianToken: string | null
}

/**
 * A chip row — the tags, rendered as pills.
 *
 * Built from table cells rather than inline-block spans with margins. Outlook
 * (Word's rendering engine) drops margin on inline elements, so a span-based
 * version arrives as one long run of touching pills. Cells with explicit
 * padding are the only thing that survives everywhere.
 */
const chipRow = (tags: string[], tone: 'good' | 'work'): string => {
  if (tags.length === 0) return ''
  const bg = tone === 'good' ? '#E6F7F0' : '#FFF4E5'
  const fg = tone === 'good' ? '#067A52' : '#8A5300'
  const cells = tags
    .map(
      (tag) =>
        `<td style="padding:0 6px 6px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
           <td style="background:${bg};color:${fg};border-radius:999px;padding:6px 13px;font-size:13px;font-weight:700;font-family:Arial,Helvetica,sans-serif;white-space:nowrap">${tagLabel(tag)}</td>
         </tr></table></td>`,
    )
    .join('')
  // A single row that wraps by table width rather than a flex container —
  // there is no flexbox in email.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0"><tr>${cells}</tr></table>`
}

const sectionLabel = (text: string) =>
  `<div style="font-size:11px;letter-spacing:.1em;font-weight:800;color:#6b7280;text-transform:uppercase;margin:20px 0 0">${text}</div>`

/**
 * The note a coach sends a player after a session — the product's whole
 * retention story in one email, and now the only thing players are asked to
 * open. It is written as a REPORT, not a notification: the full note, the tags
 * that were chosen, where they are up to this season, and the board if the
 * coach attached one.
 *
 * Copied to the guardian address when the player has set one. That is a
 * deliberate safeguarding position rather than a feature: adult-to-child
 * communication in a club setting should be visible to the adult responsible
 * for that child, and a parent who reads this every week is a parent who tells
 * the club to renew.
 *
 * The note body is included in full. A "you have a new message, log in to read
 * it" email is a notification nobody opens twice.
 *
 * English only, like every email here — see lib/feedback-tag-labels.
 */
export async function sendPlayerNoteEmail(params: PlayerNoteEmail): Promise<void> {
  const site = env.FRONTEND_URL
  // Everything below that a person typed goes through esc() before it reaches
  // the HTML. The plain-text alternative uses the raw values — escaping there
  // would show a parent "Nathan &amp; the back four".
  const player = esc(params.playerName)
  const coach = esc(params.coachName)
  const club = params.clubName ? esc(params.clubName) : null
  const noteBody = esc(params.body)
  const sessionTitle = params.session?.title ? esc(params.session.title) : null

  const from = params.clubName ? `${params.coachName} · ${params.clubName}` : params.coachName
  const fromHtml = club ? `${coach} · ${club}` : coach
  const seasonUrl = `${site}/my-football`
  const boardUrl = params.boardId ? `${site}/share/board/${params.boardId}` : null
  const guardianUrl = params.guardianToken ? `${site}/guardian/${params.guardianToken}` : null

  const when = params.session?.date
    ? params.session.date.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : null

  // "Your 7th note" reads oddly at 1, and a first note is worth marking.
  const ordinal = (n: number) => {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
    return `${n}${suffix}`
  }
  const standing =
    params.digest.total <= 1
      ? 'This is the first note from your coach.'
      : `This is your ${ordinal(params.digest.total)} note this season.`

  // Most-mentioned, only once there is enough history for it to mean anything.
  // Two notes do not make a pattern, and "mentioned once" as a headline
  // statistic makes the whole feature look automated.
  const showDigest = params.digest.total >= 3
  const topTags = (pairs: [string, number][]) =>
    pairs
      .slice(0, 3)
      .map(([tag, n]) => `${tagLabel(tag)} <strong style="color:#ffffff">×${n}</strong>`)
      .join('&nbsp;&nbsp;·&nbsp;&nbsp;')

  const textLines = [
    `Hi ${params.playerName},`,
    '',
    `${from} wrote to you${when ? ` after ${params.session?.title ?? 'training'} on ${when}` : ''}:`,
    '',
    params.body ? `"${params.body}"` : '(no message — see the tags below)',
  ]
  if (params.strengths.length > 0) {
    textLines.push('', `Did well: ${params.strengths.map(tagLabel).join(', ')}`)
  }
  if (params.workOns.length > 0) {
    textLines.push(`Work on: ${params.workOns.map(tagLabel).join(', ')}`)
  }
  textLines.push('', standing)
  if (showDigest && params.digest.strengths.length > 0) {
    textLines.push(
      `Mentioned most this season: ${params.digest.strengths.slice(0, 3).map(([t, n]) => `${tagLabel(t)} x${n}`).join(', ')}`,
    )
  }
  if (boardUrl) textLines.push('', `Watch the move your coach attached:\n${boardUrl}`)
  textLines.push('', `See your whole season:\n${seasonUrl}`)
  if (guardianUrl) {
    textLines.push(
      '',
      `Parent or guardian — everything ${params.playerName}'s coach has written:\n${guardianUrl}`,
    )
  }

  await sendSafely(
    {
      to: params.cc ? `${params.to}, ${params.cc}` : params.to,
      // Named, and says what it is. "You have a new notification" is what an
      // unopened email looks like.
      subject: params.session?.title
        ? `${params.coachName} on ${params.session.title}`
        : `${params.coachName} left you a note`,
      text: textLines.join('\n'),
      html: layout(
        `${coach} wrote to you${when ? ` after ${when}` : ''}.`,
        `${kicker('YOUR SESSION REPORT')}
         <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25">Nice work, ${player} ⚽</h1>
         <p style="margin:0 0 2px;color:#6b7280;font-size:13.5px">
           From <strong style="color:#1a2332">${fromHtml}</strong>${
             sessionTitle ? `<br>${sessionTitle}${when ? ` &middot; ${when}` : ''}` : ''
           }
         </p>

         ${
           noteBody
             ? `<blockquote style="margin:20px 0 0;padding:14px 18px;border-left:4px solid #00a76f;background:#f0fdf7;color:#14532d;font-size:15.5px;line-height:1.65;font-style:italic">${noteBody}</blockquote>`
             : ''
         }

         ${
           params.strengths.length > 0
             ? `${sectionLabel('What you did well')}${chipRow(params.strengths, 'good')}`
             : ''
         }
         ${
           params.workOns.length > 0
             ? `${sectionLabel('To work on next')}${chipRow(params.workOns, 'work')}`
             : ''
         }

         ${
           showDigest && params.digest.strengths.length > 0
             ? pitchCard(
                 'YOUR SEASON SO FAR',
                 `${standing}<br><span style="color:#9fe8c8">Mentioned most:</span> ${topTags(params.digest.strengths)}${
                   params.digest.workOns.length > 0
                     ? `<br><span style="color:#9fe8c8">Working on:</span> ${topTags(params.digest.workOns)}`
                     : ''
                 }`,
               )
             : `<p style="margin:20px 0 0;color:#6b7280;font-size:13.5px">${standing}</p>`
         }

         ${
           boardUrl
             ? `<p style="margin:20px 0 0;font-size:14.5px">🎬 Your coach attached a move for you to watch — <a href="${boardUrl}" style="color:#00a76f;font-weight:700">see the animation</a>.</p>`
             : ''
         }

         ${button(seasonUrl, 'See your whole season')}

         ${
           guardianUrl
             ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr>
                  <td style="border-top:1px solid #e5e7eb;padding:14px 0 0;color:#6b7280;font-size:12.5px;line-height:1.6">
                    <strong style="color:#1a2332">Parent or guardian?</strong>
                    <a href="${guardianUrl}" style="color:#00a76f">See everything ${player}'s coach has written</a> — no account needed.
                  </td>
                </tr></table>`
             : ''
         }`,
      ),
    },
    'player_note',
  )
}

export async function sendPasswordResetEmail(
  user: { id?: number; name: string; email: string },
  resetUrl: string,
  actorId?: number,
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
    'password_reset',
    { userId: user.id, actorId },
  )
}
