import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }
}
