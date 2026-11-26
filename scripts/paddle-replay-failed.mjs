#!/usr/bin/env node
// PADDLE (26 Nov 2026): resend Paddle webhook deliveries that failed — e.g.
// the local tunnel was down during a sandbox test. Paddle stops retrying after
// a few attempts and its dashboard has no resend button; the API does
// (POST /notifications/{id}/replay). Replays are safe: the webhook skips an
// event it already handled (paddle_events).
//
//   node scripts/paddle-replay-failed.mjs            # list failed, then replay them
//   node scripts/paddle-replay-failed.mjs --dry-run  # list only
//
// Reads PADDLE_API_KEY / PADDLE_ENV from .env. Never prints the key.

import 'dotenv/config'

const key = process.env.PADDLE_API_KEY
const env = process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox'
const dryRun = process.argv.includes('--dry-run')

if (!key) {
  console.error('PADDLE_API_KEY is not set in .env')
  process.exit(1)
}
if (env === 'production' && !process.argv.includes('--production')) {
  console.error('PADDLE_ENV is production. Add --production if you really mean to replay live events.')
  process.exit(1)
}

const base = env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'

async function paddle(method, path) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Paddle-Version': '1', 'Content-Type': 'application/json' },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${body?.error?.detail ?? body?.error?.code ?? ''}`)
  return body
}

const { data } = await paddle('GET', '/notifications?status=failed&per_page=50')
if (!data?.length) {
  console.log(`No failed deliveries in ${env}.`)
  process.exit(0)
}

console.log(`${data.length} failed deliver${data.length === 1 ? 'y' : 'ies'} in ${env}:`)
for (const n of data) console.log(`  ${n.id}  ${n.type}  attempts ${n.times_attempted}  ${n.occurred_at}`)
if (dryRun) process.exit(0)

for (const n of data) {
  try {
    const r = await paddle('POST', `/notifications/${n.id}/replay`)
    console.log(`Replayed ${n.id} (${n.type}) → ${r?.data?.notification_id ?? 'queued'}`)
  } catch (err) {
    console.error(`Could not replay ${n.id}: ${err.message}`)
  }
}
console.log('Done. Check Paddle → Notifications → View logs, or the API log.')
