// Certificates, public.
//
//   GET /api/certificates/:code    PUBLIC — the verify page and the certificate
//
// Anyone holding the paper can check it, so this needs no account. It returns
// only what is printed on the certificate (see certificateByCode): the name,
// the course, the score and the date — never an email or an account id.
// Rate-limited, because a public lookup by code is the one thing here worth
// trying to enumerate (the codes are random; this makes guessing slow too).

import type { FastifyInstance } from 'fastify'
import { certificateByCode } from '../ebooks/course.service.js'

export async function certificatesRoutes(app: FastifyInstance) {
  app.get('/:code', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const cert = await certificateByCode(code)
    // Not ours: a plain 404. Revoked: still 200, with revokedAt set — the
    // verify page must be able to say "this was withdrawn", not "never heard of it".
    if (!cert) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No certificate has this ID.' })
    reply.header('X-Robots-Tag', 'noindex')
    return reply.send(cert)
  })
}
