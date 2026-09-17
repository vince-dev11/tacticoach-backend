import nodemailer, { type Transporter } from 'nodemailer'
import { env } from './env.js'
import { db } from './database.js'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 23 --
// The generated client has no `emailLog` delegate until then. Narrow on
// purpose — one method, the exact shape this file writes — so it cannot hide
// a mistake anywhere else. Delete this and use `db.emailLog` directly.
interface EmailLogDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>
}
const emailLog = () => (db as unknown as { emailLog: EmailLogDelegate }).emailLog

// SMTP is optional: the API boots without it, and email-dependent routes (e.g.
// password reset) degrade gracefully. Any SMTP provider works — Gmail, Resend,
// SendGrid, SES, Postmark — by setting SMTP_HOST/SMTP_USER/SMTP_PASS.
export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
}

let transporter: Transporter | null = null
function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true for 465, false for 587/STARTTLS
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  }
  return transporter
}

export interface SendMailOptions {
  to: string
  subject: string
  html: string
  text?: string
  /**
   * Which template this is — 'account_setup', 'password_reset', … Recorded so
   * the admin's history reads as "set-password link" rather than a subject
   * line that changes with the locale.
   */
  kind?: string
  /** The account this mail is about, when there is one. */
  userId?: number
  /** The admin who triggered it, for mails a human pressed a button for. */
  actorId?: number
}

/**
 * Record the attempt.
 *
 * Deliberately here rather than at the call sites: a route can forget to log,
 * and the route that forgets is the one you end up needing a record of. Every
 * path through sendMail writes exactly one row.
 *
 * Never throws. A logging failure must not turn a delivered email into an
 * error — the mail has already gone, and failing afterwards would tell the
 * caller something untrue.
 */
async function record(
  opts: SendMailOptions,
  status: 'sent' | 'failed' | 'skipped',
  error?: unknown,
): Promise<void> {
  try {
    await emailLog().create({
      data: {
        to: opts.to.slice(0, 255),
        kind: (opts.kind ?? 'other').slice(0, 40),
        subject: opts.subject.slice(0, 255),
        status,
        // Providers return long, noisy errors; the first line is the useful
        // part and the column is bounded anyway.
        error: error ? String((error as Error)?.message ?? error).slice(0, 500) : null,
        userId: opts.userId ?? null,
        actorId: opts.actorId ?? null,
      },
    })
  } catch (logError) {
    console.error('[emails] could not write the email log', logError)
  }
}

/**
 * Send, and record what happened.
 *
 * Throws on a provider failure so callers can react — but only AFTER the
 * failure is on record, because the row is the thing an admin will look at
 * when someone says the email never arrived.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (!isMailConfigured()) {
    // A distinct status, not a failure: nothing was attempted, and the fix is
    // configuration rather than the provider. Told apart in the admin history.
    console.warn(`[emails] SMTP not configured — skipped ${opts.kind ?? 'mail'} to ${opts.to}`)
    await record(opts, 'skipped')
    return
  }

  try {
    await getTransport().sendMail({
      from: env.MAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })
  } catch (error) {
    await record(opts, 'failed', error)
    throw error
  }
  await record(opts, 'sent')
}
