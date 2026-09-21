// Who may move a book from one state to another.
//
// Once any coach can publish, "published" has to split into two facts: what
// the AUTHOR did (submitted it) and what WE decided (it is public). Conflating
// them is how a stranger's first book lands on the front page of the shop —
// and these books can mention children, so the review is not only about
// quality.
//
// The rules live here rather than inline in the routes because there are two
// callers (the author's PATCH and the owner's review action) and they must
// agree. A transition allowed in one and forbidden in the other is the kind of
// bug that only shows up as "how did that get published?".
//
//   draft ──submit──▶ in_review ──approve──▶ published
//     ▲                   │                      │
//     │                   └──reject──▶ rejected  └──unpublish──▶ draft
//     └───────────────edit────────────────┘
//
// An author may: submit, and edit anything not in_review or published.
// An owner may: approve, reject, unpublish, archive — and anything an author
// may, because the owner is also an author of their own books.

export const EBOOK_STATUSES = ['draft', 'in_review', 'published', 'rejected', 'archived'] as const
export type EbookStatus = (typeof EBOOK_STATUSES)[number]

/** Statuses a coach may set on their own book, directly. */
const AUTHOR_MAY_SET: EbookStatus[] = ['draft', 'in_review', 'archived']

/**
 * Statuses in which the CONTENT is frozen to its author.
 *
 * A book being reviewed must not change under the reviewer — approving what
 * you read is meaningless if the author edited it while you read it. A
 * published book must not change silently either: it is in the shop, and
 * someone may have bought it.
 */
const FROZEN_TO_AUTHOR: EbookStatus[] = ['in_review', 'published']

export function isFrozenToAuthor(status: EbookStatus): boolean {
  return FROZEN_TO_AUTHOR.includes(status)
}

export interface TransitionResult {
  ok: boolean
  /** Why not — shown to whoever tried it. */
  reason?: string
  /** What to write, when ok. Only the fields that change. */
  patch?: {
    status: EbookStatus
    submittedAt?: Date | null
    publishedAt?: Date | null
    reviewNote?: string | null
  }
}

/**
 * Can this actor move the book from `from` to `to`?
 *
 * `firstPublishAt` is the book's existing publishedAt: stamped on the FIRST
 * approval and never moved, so a book rejected twice and approved on the third
 * pass is not three months old in the shop.
 */
export function transition(opts: {
  from: EbookStatus
  to: EbookStatus
  isOwner: boolean
  firstPublishAt: Date | null
  /** Required when rejecting. */
  note?: string | null
  /** Does the actor's plan allow publishing at all? */
  canPublish: boolean
  /** Does the book have at least one chapter with a block in it? */
  hasContent: boolean
}): TransitionResult {
  const { from, to, isOwner, firstPublishAt, note, canPublish, hasContent } = opts

  if (from === to) return { ok: true, patch: { status: to } }

  // ---- The owner's moves ---------------------------------------------------
  if (to === 'published') {
    // Only an owner publishes. An author asking for `published` is asking to
    // skip the queue; they get `in_review` instead, which is what they meant.
    if (!isOwner) return { ok: false, reason: 'Only a reviewer can publish a book. Submit it for review instead.' }
    return {
      ok: true,
      patch: {
        status: 'published',
        publishedAt: firstPublishAt ?? new Date(),
        reviewNote: null,
      },
    }
  }

  if (to === 'rejected') {
    if (!isOwner) return { ok: false, reason: 'Only a reviewer can reject a book.' }
    // A rejection with no reason is the same as silence, and the coach simply
    // resubmits the identical book.
    if (!note?.trim()) return { ok: false, reason: 'Say why it was sent back — the author sees this.' }
    return { ok: true, patch: { status: 'rejected', reviewNote: note.trim() } }
  }

  // ---- The author's moves --------------------------------------------------
  if (to === 'in_review') {
    if (!canPublish) {
      return { ok: false, reason: 'Your plan lets you write a book but not publish it. Upgrade to publish.' }
    }
    // An empty book wastes a reviewer's time and embarrasses the author.
    if (!hasContent) {
      return { ok: false, reason: 'Add at least one chapter with something in it before submitting.' }
    }
    return { ok: true, patch: { status: 'in_review', submittedAt: new Date(), reviewNote: null } }
  }

  if (to === 'draft') {
    // Pulling a PUBLISHED book back to draft takes it out of the shop, which
    // is an owner decision — a reader may be halfway through it.
    if (from === 'published' && !isOwner) {
      return { ok: false, reason: 'Ask us to unpublish it — someone may be reading it.' }
    }
    return { ok: true, patch: { status: 'draft', reviewNote: null } }
  }

  if (!isOwner && !AUTHOR_MAY_SET.includes(to)) {
    return { ok: false, reason: 'You cannot set that status.' }
  }

  return { ok: true, patch: { status: to } }
}
