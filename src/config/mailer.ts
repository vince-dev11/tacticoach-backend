import nodemailer, { type Transporter } from 'nodemailer'
import { env } from './env.js'

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

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<void> {
  await getTransport().sendMail({
    from: env.MAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  })
}
