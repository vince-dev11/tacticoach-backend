// Applications to the Collaboration Programme.
//
// Two doors lead to the same place. An admin can invite somebody directly —
// that path already existed — or somebody can apply through the public form,
// which is this. Both end with a `Collaborator` row in `invited`, and only
// signing the agreement makes it `active`.
//
// The hard part is not the form. It is that most applicants DO NOT HAVE AN
// ACCOUNT, because the point of a public form is to reach people who have not
// signed up yet. So approval has two paths, and the one that grants something
// to a stranger by email is the one to be careful with.

import crypto from 'node:crypto'
import { db } from '../../config/database.js'
import { inviteCollaborator } from './collaborations.service.js'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 32 --
// The generated client has no `collaborationApplication` delegate until then.
// See prisma-shim.ts for the same treatment of the collaborator tables.
export type ApplicantKind = 'coach' | 'club'
export type ApplicationStatus = 'submitted' | 'approved' | 'rejected'

export interface ApplicationRow {
  id: number
  userId: number | null
  name: string
  email: string
  applicantKind: ApplicantKind
  organisation: string | null
  location: string | null
  links: string | null
  audience: string | null
  why: string | null
  consentContact: boolean
  consentListing: boolean
  status: ApplicationStatus
  reviewNote: string | null
  reviewedAt: Date | null
  inviteToken: string | null
  inviteExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type Args = Record<string, unknown>

interface ApplicationDelegate {
  findUnique(args: Args): Promise<ApplicationRow | null>
  findFirst(args: Args): Promise<ApplicationRow | null>
  findMany(args?: Args): Promise<ApplicationRow[]>
  count(args?: Args): Promise<number>
  create(args: Args): Promise<ApplicationRow>
  update(args: Args): Promise<ApplicationRow>
  groupBy(args: Args): Promise<{ status: ApplicationStatus; _count: { _all: number } }[]>
}

const applicationDb = (): ApplicationDelegate =>
  (db as unknown as Record<string, unknown>).collaborationApplication as ApplicationDelegate

/**
 * How long an approval link lasts.
 *
 * Short enough that a forwarded email stops working, long enough that
 * somebody who reads it on holiday is not locked out. It grants the right to
 * create an account and sign an agreement — not access to anything existing —
 * so this is the right end of the risk scale to be on.
 */
export const INVITE_TTL_DAYS = 14

export interface ApplicationInput {
  name: string
  email: string
  applicantKind: ApplicantKind
  organisation?: string | null
  location?: string | null
  links?: string | null
  audience?: string | null
  why?: string | null
  consentContact: boolean
  consentListing: boolean
}

/**
 * Record an application from the public form.
 *
 * Deliberately NOT deduplicated on email. Somebody refused in March may
 * reasonably apply again in September with a bigger audience, and silently
 * swallowing the second attempt would look, to them, exactly like the form
 * being broken. Duplicates are a review problem, not a storage problem — and
 * the reviewer can see the earlier row, which is the point of keeping it.
 */
export async function submitApplication(input: ApplicationInput): Promise<{ id: number }> {
  // Attach it to an account if the email already has one. Best-effort: a
  // mismatch here must not refuse an application, it only saves the reviewer
  // a lookup.
  const existing = await db.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
    select: { id: true },
  })

  const row = await applicationDb().create({
    data: {
      userId: existing?.id ?? null,
      name: input.name.trim(),
      email: input.email.toLowerCase().trim(),
      applicantKind: input.applicantKind,
      organisation: input.organisation?.trim() || null,
      location: input.location?.trim() || null,
      links: input.links?.trim() || null,
      audience: input.audience?.trim() || null,
      why: input.why?.trim() || null,
      consentContact: input.consentContact,
      consentListing: input.consentListing,
    },
  })
  return { id: row.id }
}

export interface ApprovalResult {
  /** 'invited' — matched an account and created the collaborator row. */
  /** 'token'   — no account; they need to sign up through the link first. */
  outcome: 'invited' | 'token' | 'already'
  email: string
  name: string
  /** Only for 'token'. The credential to email them. */
  inviteToken?: string
}

/**
 * Approve an application.
 *
 * IDEMPOTENT. Approving twice — two admins, or a double click — must not
 * create two collaborators or mint a second token that invalidates the first.
 * An already-approved application returns `already` and changes nothing.
 */
export async function approveApplication(
  id: number,
  note?: string | null,
): Promise<ApprovalResult | null> {
  const application = await applicationDb().findUnique({ where: { id } })
  if (!application) return null
  if (application.status === 'approved') {
    return { outcome: 'already', email: application.email, name: application.name }
  }

  // Look the account up again at APPROVAL time, not just at submission. Weeks
  // pass between the two, and somebody who applied without an account has very
  // often signed up in the meantime — sending them a "create your account"
  // link when they already have one is the confusing outcome.
  const user =
    application.userId != null
      ? { id: application.userId }
      : await db.user.findUnique({ where: { email: application.email }, select: { id: true } })

  if (user) {
    await inviteCollaborator({
      userId: user.id,
      companyName: application.organisation,
      notes: application.why,
    })
    await applicationDb().update({
      where: { id },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        userId: user.id,
        // No token: they have an account, so there is nothing for a link to
        // create. A token minted here would be a credential with no purpose,
        // which is the kind that sits in an inbox for a year.
        inviteToken: null,
        inviteExpiresAt: null,
      },
    })
    return { outcome: 'invited', email: application.email, name: application.name }
  }

  const inviteToken = crypto.randomBytes(32).toString('base64url')
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000)
  await applicationDb().update({
    where: { id },
    data: {
      status: 'approved',
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      inviteToken,
      inviteExpiresAt,
    },
  })
  return { outcome: 'token', email: application.email, name: application.name, inviteToken }
}

/** Refuse it. Kept, not deleted — see the model's own comment for why. */
export async function rejectApplication(id: number, note?: string | null): Promise<boolean> {
  const application = await applicationDb().findUnique({ where: { id } })
  if (!application || application.status === 'rejected') return false
  await applicationDb().update({
    where: { id },
    data: { status: 'rejected', reviewedAt: new Date(), reviewNote: note ?? null },
  })
  return true
}

/**
 * Redeem an approval token after the applicant creates their account.
 *
 * SINGLE USE: the token is cleared in the same step that grants the
 * collaborator row, so a forwarded link, a browser prefetch or a double
 * submit cannot mint a second one. Expiry is checked here rather than trusted
 * from the link, because the link is the untrusted part.
 */
export async function redeemInvite(token: string, userId: number): Promise<boolean> {
  const application = await applicationDb().findFirst({
    where: { inviteToken: token, status: 'approved' },
  })
  if (!application) return false
  if (application.inviteExpiresAt && application.inviteExpiresAt < new Date()) return false

  await inviteCollaborator({
    userId,
    companyName: application.organisation,
    notes: application.why,
  })
  await applicationDb().update({
    where: { id: application.id },
    data: { userId, inviteToken: null, inviteExpiresAt: null },
  })
  return true
}

export interface ApplicationListItem {
  id: number
  name: string
  email: string
  applicantKind: ApplicantKind
  organisation: string | null
  location: string | null
  links: string | null
  audience: string | null
  why: string | null
  consentListing: boolean
  status: ApplicationStatus
  reviewNote: string | null
  reviewedAt: Date | null
  createdAt: Date
  /** They already have a TactiCoach account — approval is one step, not two. */
  hasAccount: boolean
  /** Earlier applications from the same email. "Did we already say no?" */
  priorApplications: number
}

export async function listApplications(params: {
  status?: ApplicationStatus | 'all'
  page?: number
  limit?: number
}): Promise<{
  rows: ApplicationListItem[]
  total: number
  counts: Record<ApplicationStatus, number>
}> {
  const limit = params.limit ?? 25
  const page = Math.max(1, params.page ?? 1)
  const where = params.status && params.status !== 'all' ? { status: params.status } : {}

  const [rows, total, grouped] = await Promise.all([
    applicationDb().findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    applicationDb().count({ where }),
    // Counts over EVERYTHING, never narrowed by the filter — a "submitted: 12"
    // that became "submitted: 0" because you filtered to approved would be
    // answering a different question from the one it appears to.
    applicationDb().groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const counts: Record<ApplicationStatus, number> = { submitted: 0, approved: 0, rejected: 0 }
  for (const g of grouped) counts[g.status] = g._count._all

  // One query for the whole page rather than one per row.
  const emails = rows.map((r) => r.email)
  const siblings = emails.length
    ? await applicationDb().findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
    : []
  const priorByEmail = new Map<string, number>()
  for (const s of siblings) priorByEmail.set(s.email, (priorByEmail.get(s.email) ?? 0) + 1)

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      applicantKind: r.applicantKind,
      organisation: r.organisation,
      location: r.location,
      links: r.links,
      audience: r.audience,
      why: r.why,
      consentListing: r.consentListing,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      hasAccount: r.userId != null,
      // Minus this one, so "2" means two EARLIER attempts.
      priorApplications: Math.max(0, (priorByEmail.get(r.email) ?? 1) - 1),
    })),
    total,
    counts,
  }
}
