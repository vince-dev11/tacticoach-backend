// DISPOSABLE-EMAIL (25 Nov 2026, owner): sign-up and early access need an
// email the person will keep — throwaway inboxes (yopmail, mailinator,
// 10minutemail …) are refused with a clear message. And SAME-INBOX: Gmail
// ignores dots and anything after a "+", so john.smith+2@gmail.com is the
// same inbox as johnsmith@gmail.com — a second account (and a second free
// trial) for one inbox is refused.
//
// New sign-ups only: existing accounts are never checked or touched.

import { env } from '../config/env.js'
import { DISPOSABLE_DOMAINS } from './disposable-domains.js'

/**
 * Never throwaway, whatever the list says: real providers and privacy relays
 * that forward to a real inbox. Kept identical to scripts/never-block-domains.mjs
 * (a test checks).
 */
export const NEVER_BLOCK = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'web.de', 'zoho.com', 'yandex.com', 'mail.com',
  'privaterelay.appleid.com', 'mozmail.com', 'duck.com', 'simplelogin.com', 'simplelogin.co', 'slmail.me',
  'aleeas.com', 'addy.io', 'anonaddy.com', 'anonaddy.me', 'passmail.net', 'passinbox.com',
  'tacticoach.co.uk', 'tacticoach.test',
]

let blocked: Set<string> | null = null
const list = () => (blocked ??= new Set(DISPOSABLE_DOMAINS.split('\n')))

const domainOf = (email: string) => email.trim().toLowerCase().split('@').pop() ?? ''

/** Is this a throwaway inbox? The domain or any parent domain on the list (x.yopmail.com too). */
export function isDisposableEmail(email: string): boolean {
  if (!env.BLOCK_DISPOSABLE_EMAILS) return false
  const domain = domainOf(email)
  if (!domain || NEVER_BLOCK.includes(domain)) return false
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (list().has(parts.slice(i).join('.'))) return true
  }
  return false
}

export const DISPOSABLE_MESSAGE =
  "This looks like a temporary email address. Please use an email you'll keep — we send your login link, receipts and important account emails there."

export const SAME_INBOX_MESSAGE =
  'There is already a TactiCoach account for this email inbox. Email providers like Gmail ignore dots and anything after a “+”, so these count as the same address. Log in to your account, or use a different email.'

/**
 * The inbox an address really delivers to: lower case, no "+tag", and for
 * Gmail no dots (googlemail.com is gmail.com).
 */
export function inboxOf(email: string): string {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return e
  let local = e.slice(0, at)
  let domain = e.slice(at + 1)
  local = local.split('+')[0] || local
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}
