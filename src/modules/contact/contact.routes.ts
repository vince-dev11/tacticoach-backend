// Contact form — public endpoint the landing page's /contact form posts to.
// Field names are snake_case to match the existing frontend client
// (src/lib/contact.ts sends { first_name, last_name, email, message }).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isMailConfigured, sendMail } from '../../config/mailer.js'
import { buildContactEmail } from '../../lib/emails.js'
import { db } from '../../config/database.js'

const ContactSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  message: z.string().min(10).max(5000),
})

export async function contactRoutes(app: FastifyInstance) {
  // POST /contact — tighter rate limit than the global one: it's public,
  // unauthenticated and sends email (spam target).
  app.post(
    '/',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = ContactSchema.parse(request.body)

      // Persist the lead first — it feeds the CRM inbox (/admin/leads) and
      // survives any email trouble. Best-effort: storage issues shouldn't
      // block the user's message if email still works.
      try {
        await db.contactMessage.create({
          data: {
            firstName: input.first_name,
            lastName: input.last_name,
            email: input.email,
            message: input.message,
          },
        })
      } catch (err) {
        request.log.error({ err }, 'Failed to store contact lead')
      }

      if (!isMailConfigured()) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Messaging is temporarily unavailable. Please email us directly.',
        })
      }

      try {
        await sendMail(
          buildContactEmail({
            firstName: input.first_name,
            lastName: input.last_name,
            email: input.email,
            message: input.message,
          }),
        )
      } catch (err) {
        request.log.error({ err }, 'Failed to deliver contact form email')
        return reply.status(502).send({
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'We could not deliver your message. Please try again later.',
        })
      }

      return reply.send({ message: 'Thanks! Your message has been sent — we will get back to you soon.' })
    },
  )
}
