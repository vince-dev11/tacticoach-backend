import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

export function errorHandler(error: FastifyError, _req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(422).send({
      statusCode: 422,
      error: 'Validation Error',
      issues: error.flatten().fieldErrors,
    })
  }

  const status = error.statusCode ?? 500
  if (status >= 500) {
    console.error(error)
  }

  reply.status(status).send({
    statusCode: status,
    error: error.name ?? 'Error',
    message: error.message ?? 'Internal Server Error',
  })
}
