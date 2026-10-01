// Contact form — public endpoint the landing page's /contact form posts to.
// Field names are snake_case to match the existing frontend client
// (src/lib/contact.ts sends { first_name, last_name, email, message }).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isMailConfigured, sendMail } from '../../config/mailer.js'
import { buildContactEmail } from '../../lib/emails.js'
import { db } from '../../config/database.js'
import { captureError } from '../../lib/observability.js'
import { CONTACT_TOPICS, TOPIC_LABEL, type ContactTopic } from './topics.js'

const ContactSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().trim().email().max(255),
  message: z.string().min(10).max(5000),
  /** What it is about — decides Leads or Support in the admin area. Optional
      so a page loaded before this shipped still sends; missing = `other`. */
  topic: z.enum(CONTACT_TOPICS).optional(),
})

export async function contactRoutes(app: FastifyInstance) {
  // POST /contact — tighter rate limit than the global one: it's public,
  // unauthenticated and sends email (spam target).
  app.post(
    '/',
    { config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 10_000 : process.env.NODE_ENV === 'production' ? 5 : 500, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = ContactSchema.parse(request.body)
      const email = input.email.trim().toLowerCase()
      const message = input.message.trim()
      const topic: ContactTopic = input.topic ?? 'other'
      const thanks = { message: 'Thanks! Your message has been sent — we will get back to you soon.' }

      // The same message from the same address in the last day is the same
      // message: someone pressing Send again because the page did not seem to
      // react. Our first real support request arrived four times that way.
      // Answer as if it were sent (it was), and neither store nor email it twice.
      try {
        const dup = await db.contactMessage.findFirst({
          where: { email, message, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          select: { id: true },
        })
        if (dup) return reply.send(thanks)
      } catch (err) {
        request.log.warn({ err }, 'Contact duplicate check failed')
      }

      // Persist the lead first — it feeds the CRM inbox (/admin/leads) and
      // survives any email trouble.
      let stored = false
      try {
        await db.contactMessage.create({
          data: {
            firstName: input.first_name, lastName: input.last_name, email, message, topic,
            // They told us they are a club: no need for an admin to set it.
            ...(topic === 'club' ? { kind: 'club' as const } : {}),
          },
        })
        stored = true
      } catch (err) {
        request.log.error({ err }, 'Failed to store contact lead')
        captureError(err, { request, tags: { step: 'store-contact-lead' } })
      }

      // Once the message is in the inbox, it has reached us — whatever the
      // email notification does. Telling the visitor "we could not deliver
      // your message" when it is sitting in the inbox is what made them send
      // it again and again. They only see an error when it is truly lost.
      if (!isMailConfigured()) {
        if (stored) return reply.send(thanks)
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
            email,
            message,
            topic: TOPIC_LABEL[topic],
          }),
        )
      } catch (err) {
        request.log.error({ err }, 'Failed to deliver contact form email')
        captureError(err, { request, tags: { step: 'deliver-contact-email' } })
        if (stored) return reply.send(thanks)
        return reply.status(502).send({
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'We could not deliver your message. Please try again later.',
        })
      }

      return reply.send(thanks)
    },
  )
}
