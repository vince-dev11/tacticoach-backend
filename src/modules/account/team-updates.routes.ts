// BULK-MAIL (4 Nov 2026): the one-click opt-out in every team update.
//
//   GET /api/account/team-updates/opt-out?u=<id>&t=<token>
//
// Public on purpose — people click it from a mail app on a phone, signed out.
// The token is an HMAC of the id (lib/team-updates.ts), so a guessed id does
// nothing. Answers a small page in the email's own style rather than JSON:
// the person reading it is a coach, not a program. Rate-limited like the
// other unauthenticated routes.
import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'
import { optOut, optOutTokenOk } from '../../lib/team-updates.js'

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — TactiCoach</title>
<style>body{margin:0;background:#0c1120;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif}main{max-width:520px;margin:48px auto;padding:32px 24px;background:#111827;border-radius:14px}h1{font-size:22px;margin:0 0 12px}p{line-height:1.55;color:#cbd5e1;margin:0 0 12px}a{color:#34e0a1}</style></head>
<body><main><h1>${title}</h1>${body}<p><a href="${env.FRONTEND_URL}">tacticoach.co.uk</a></p></main></body></html>`

export async function teamUpdatesRoutes(app: FastifyInstance) {
  app.get('/team-updates/opt-out', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) => {
    const q = request.query as { u?: string; t?: string }
    const id = Number(q.u)
    const ok = Number.isInteger(id) && id > 0 && typeof q.t === 'string' && optOutTokenOk(id, q.t) && (await optOut(id))
    reply.type('text/html; charset=utf-8')
    if (!ok) {
      return reply.status(400).send(page(
        'This link doesn’t work',
        '<p>It may have been cut short by your mail app. Open the email again and tap the link once more, or write to us and we’ll do it for you.</p>',
      ))
    }
    return reply.send(page(
      'You won’t get team updates any more',
      '<p>Done — no more news or updates from the TactiCoach team to this address.</p><p>Notices about your account, your plan and your players still reach you; those are part of having an account.</p>',
    ))
  })
}
