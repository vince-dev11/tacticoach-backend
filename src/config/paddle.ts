// PADDLE (25 Nov 2026): Paddle Billing — the merchant of record for plans and
// books. A small fetch client on purpose (no SDK dependency): we use a handful
// of endpoints, and the webhook signature is twelve lines of HMAC.
//
// Card details never reach us: Paddle's overlay checkout collects them on our
// /checkout page (Paddle.js, loaded from cdn.paddle.com).

import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'
import { stripeConfigured } from './stripe.js'

export function paddleConfigured(): boolean {
  return !!env.PADDLE_API_KEY
}

/** Which gateway takes NEW payments. Paddle wins once its key is set. */
export type BillingProvider = 'paddle' | 'stripe'
export function billingProvider(): BillingProvider | null {
  if (paddleConfigured()) return 'paddle'
  if (stripeConfigured()) return 'stripe'
  return null
}

export function paddleApiBase(): string {
  return env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'
}

export class PaddleError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

/** One Paddle API call. Returns `data` (Paddle wraps every response in it). */
export async function paddle<T = unknown>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  if (!env.PADDLE_API_KEY) {
    const err = new Error('Billing is not configured on this server') as Error & { statusCode: number }
    err.statusCode = 503
    throw err
  }
  const res = await fetch(`${paddleApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; detail?: string } }
  if (!res.ok) {
    throw new PaddleError(res.status, json.error?.code ?? 'paddle_error', json.error?.detail ?? `Paddle ${method} ${path} failed (${res.status})`)
  }
  return json.data as T
}

/** Paddle money is a string of minor units ("899"). */
export function minor(amount: string | number | null | undefined): number {
  const n = Number(amount ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** How old a signed delivery may be. Paddle retries with a fresh signature. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Is this delivery really from Paddle? Header `Paddle-Signature: ts=…;h1=…`;
 * h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`). During a secret rotation more
 * than one h1 is sent — any match is enough. The RAW body must be used: a
 * re-serialised JSON body would not match.
 */
export function verifyPaddleSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false
  let ts = ''
  const h1s: string[] = []
  for (const part of header.split(';')) {
    const [k, v] = part.split('=')
    if (k?.trim() === 'ts') ts = (v ?? '').trim()
    if (k?.trim() === 'h1' && v) h1s.push(v.trim())
  }
  const tsNum = Number(ts)
  if (!ts || !Number.isFinite(tsNum) || !h1s.length) return false
  if (Math.abs(nowSeconds - tsNum) > SIGNATURE_TOLERANCE_SECONDS) return false
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex'), 'utf8')
  return h1s.some((h) => {
    const got = Buffer.from(h, 'utf8')
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}
