// CRM-PIPELINE (28 Oct 2026, owner): the sales side of Leads — stages,
// follow-ups, deal value, a timeline, and the account a lead became.
// Mounted inside adminRoutes (authGuard + requireOwner apply).
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { trialEndsAt } from './user-filters.js'
import { boxWhere } from '../contact/topics.js'

export const LEAD_STAGES = ['new', 'contacted', 'demo', 'trial', 'won', 'lost'] as const
export type LeadStage = (typeof LEAD_STAGES)[number]
export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', demo: 'Demo', trial: 'Trial', won: 'Won', lost: 'Lost',
}

/** The end of today in UTC — "due" means on or before it. */
export function endOfToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
}

export interface LeadAccount { id: number; joinedAt: Date; plan: 'paying' | 'trial' | 'free' }

/** The account each lead's email belongs to, if any: paying, on trial, or free. */
export async function accountsFor(emails: string[], now = new Date()): Promise<Map<string, LeadAccount>> {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))]
  if (!unique.length) return new Map()
  const users = await db.user.findMany({
    where: { email: { in: unique } },
    select: {
      id: true, email: true, createdAt: true, accountType: true, freeTrialEndsAt: true,
      subscription: { select: { status: true, expiresAt: true, paymentProvider: true } },
    },
  })
  const out = new Map<string, LeadAccount>()
  for (const u of users ?? []) {
    const sub = u.subscription
    const paying = sub?.status === 'active' && sub.paymentProvider === 'stripe'
    const trialEnd = paying ? null : trialEndsAt({ accountType: u.accountType, freeTrialEndsAt: u.freeTrialEndsAt, subscription: sub ? { status: sub.status, expiresAt: sub.expiresAt } : null }, now)
    out.set(u.email.toLowerCase(), { id: u.id, joinedAt: u.createdAt, plan: paying ? 'paying' : trialEnd && trialEnd > now ? 'trial' : 'free' })
  }
  return out
}

/** Pipeline numbers for the leads box. Pure, so it can be tested. */
export function pipelineOf(
  leads: { stage: LeadStage; channel: string | null; dealValuePence: number | null; followUpAt: Date | null; stageChangedAt: Date | null }[],
  now = new Date(),
) {
  const byStage = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>
  const channels: Record<string, { total: number; won: number }> = {}
  let openValue = 0
  let due = 0
  let wonThisMonth = 0
  const month = now.toISOString().slice(0, 7)
  const end = endOfToday(now)
  for (const l of leads) {
    byStage[l.stage] += 1
    const ch = l.channel ?? 'unknown'
    channels[ch] ??= { total: 0, won: 0 }
    channels[ch].total += 1
    if (l.stage === 'won') {
      channels[ch].won += 1
      if (l.stageChangedAt && l.stageChangedAt.toISOString().slice(0, 7) === month) wonThisMonth += 1
    }
    const open = l.stage !== 'won' && l.stage !== 'lost'
    if (open && l.dealValuePence) openValue += l.dealValuePence
    if (open && l.followUpAt && l.followUpAt <= end) due += 1
  }
  const decided = byStage.won + byStage.lost
  return {
    byStage, openValuePence: openValue, followUpsDue: due, wonThisMonth,
    winRate: decided ? byStage.won / decided : null,
    byChannel: Object.entries(channels).map(([channel, c]) => ({ channel, ...c, rate: c.total ? c.won / c.total : 0 }))
      .sort((a, b) => b.total - a.total),
  }
}

export async function logActivity(leadId: number, kind: 'note' | 'stage' | 'followup' | 'reply', text: string, createdById?: number | null) {
  await db.leadActivity.create({ data: { leadId, kind, text: text.slice(0, 1000), createdById: createdById ?? null } })
}

export async function crmRoutes(app: FastifyInstance) {
  // GET /admin/leads/pipeline — stage counts, open value, follow-ups due, win rate by channel.
  app.get('/leads/pipeline', async () => {
    const leads = await db.contactMessage.findMany({
      where: boxWhere('leads'),
      select: { stage: true, channel: true, dealValuePence: true, followUpAt: true, stageChangedAt: true },
    })
    return pipelineOf(leads as never)
  })

  // GET /admin/leads/:id/activity — the timeline, newest first.
  app.get('/leads/:id/activity', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params)
    const lead = await db.contactMessage.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return reply.status(404).send({ message: 'Lead not found' })
    const rows = await db.leadActivity.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 200 })
    return { activity: rows }
  })

  // POST /admin/leads/:id/notes { text } — add a note to the timeline.
  app.post('/leads/:id/notes', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params)
    const { text } = z.object({ text: z.string().trim().min(1, { message: 'Write the note' }).max(1000) }).parse(request.body)
    const lead = await db.contactMessage.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return reply.status(404).send({ message: 'Lead not found' })
    await logActivity(id, 'note', text, (request.user as { sub?: number } | undefined)?.sub)
    return reply.status(201).send({ ok: true })
  })
}
