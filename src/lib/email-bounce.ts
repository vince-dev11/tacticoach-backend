// ONBOARDING-EMAIL (20 Oct 2026) · bounces reported by the email provider.
//
// SMTP only tells us the provider ACCEPTED a message; a mailbox that doesn't
// exist, a blocked sender or a spam complaint arrives later. Brevo (the free
// provider recommended in docs/setup/Email_And_Stripe_Setup_2026-10-20.md) posts those
// to our webhook. This file turns one of its events into "this email failed",
// on the email_log row Admin → Users already reads ("last email failed").
//
// Payload (developers.brevo.com/docs/transactional-webhooks): `event` is one of
// hard_bounce, soft_bounce, blocked, spam, invalid_email, error, unsubscribed,
// delivered, request, …; with `email`, `message-id`, `reason`, `subject`.

import { db } from '../config/database.js'

/** "<abc@host>" and "abc@host" are the same Message-ID. */
export function normaliseMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').slice(0, 255)
}

/** Events that mean the email did not reach a person. Soft bounces count only once the provider gives up (it sends them then). */
const FAILED: Record<string, string> = {
  hard_bounce: 'Bounced: the address does not exist',
  soft_bounce: 'Bounced (temporary, gave up)',
  blocked: 'Blocked by the provider',
  invalid_email: 'Not a valid email address',
  spam: 'Marked as spam by the recipient',
  error: 'The provider could not send it',
}

export interface BounceEvent {
  event?: string
  email?: string
  'message-id'?: string
  reason?: string
  subject?: string
}

/**
 * Mark the email this event is about as failed. Found by its Message-ID, or
 * else the latest email sent to that address. Returns whether a row changed.
 */
export async function applyBounce(ev: BounceEvent): Promise<boolean> {
  const label = ev.event ? FAILED[ev.event] : undefined
  if (!label) return false
  const error = (ev.reason ? `${label} — ${ev.reason}` : label).slice(0, 500)
  const mid = ev['message-id'] ? normaliseMessageId(ev['message-id']) : null
  if (mid) {
    const byId = await db.emailLog.updateMany({ where: { providerMessageId: mid }, data: { status: 'failed', error } })
    if (byId.count > 0) return true
  }
  const to = ev.email?.trim().toLowerCase()
  if (!to) return false
  const latest = await db.emailLog.findFirst({ where: { to, status: 'sent' }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!latest) return false
  await db.emailLog.update({ where: { id: latest.id }, data: { status: 'failed', error } })
  return true
}
