// Contact form — public endpoint the landing page's /contact form posts to.
// Field names are snake_case to match the existing frontend client
// (src/lib/contact.ts sends { first_name, last_name, email, message }).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isMailConfigured, sendMail } from '../../config/mailer.js'
import { buildContactEmail } from '../../lib/emails.js'
import { db } from '../../config/database.js'
import { captureError } from '../../lib/observability.js'
import { storedLocale } from '../../lib/email-i18n.js'
import { CONTACT_TOPICS, LEAD_TOPICS, TOPIC_LABEL, type ContactTopic } from './topics.js'

const ContactSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().trim().email().max(255),
  message: z.string().min(10).max(5000),
  /** What it is about — decides Leads or Support in the admin area. Optional
      so a page loaded before this shipped still sends; missing = `other`. */
  topic: z.enum(CONTACT_TOPICS).optional(),
  /** ONBOARDING-EMAIL: the language of the page they wrote from ('es', 'pt-BR'…), carried into their account's emails. */
  locale: z.string().trim().max(10).optional(),
  /** Early access says who they are; a coach is recorded as one (a club already is, by topic). */
  kind: z.enum(['coach', 'club']).optional(),
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
      //
      // LEAD-ONCE (owner, 13 Oct 2026): one lead per person. Someone asking
      // for early access or a demo again — a returning visitor, a different
      // plan in the message — joins their open lead rather than adding a row
      // to Leads each time. The new words go under the old ones with the date,
      // the lead comes back to "New", and `times` counts the asks. Support
      // questions stay separate: two problems are two tickets.
      let stored = false
      try {
        const isLead = (LEAD_TOPICS as readonly string[]).includes(topic)
        const open = isLead
          ? await db.contactMessage.findFirst({
              where: {
                email,
                status: { not: 'closed' },
                OR: [{ topic: null }, { topic: { in: [...LEAD_TOPICS] } }],
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true, message: true, times: true, kind: true },
            })
          : null
        if (open) {
          const stamp = new Date().toISOString().slice(0, 10)
          await db.contactMessage.update({
            where: { id: open.id },
            data: {
              message: open.message ? `${open.message}\n\n— ${stamp} —\n${message}` : message,
              times: open.times + 1,
              status: 'new',
              // They told us they are a club this time.
              ...(topic === 'club' ? { topic, kind: 'club' as const } : {}),
              ...(storedLocale(input.locale) ? { locale: storedLocale(input.locale) } : {}),
              ...(input.kind === 'coach' && open.kind === 'unknown' ? { kind: 'coach' as const } : {}),
            },
          })
        } else {
          await db.contactMessage.create({
            data: {
              firstName: input.first_name, lastName: input.last_name, email, message, topic,
              // They told us they are a club: no need for an admin to set it.
              ...(topic === 'club' ? { kind: 'club' as const } : input.kind === 'coach' ? { kind: 'coach' as const } : {}),
              locale: storedLocale(input.locale),
            },
          })
        }
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
