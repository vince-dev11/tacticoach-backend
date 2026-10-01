// What a contact-form message is about, and which admin inbox it lands in.
//
//   Leads   — somebody who might buy: pricing / a demo, or a club.
//   Support — somebody who already uses us, or has a problem: account,
//             billing, a bug, a complaint, feedback, anything else.
//
// The frontend has the same list (tacticoach-frontend src/lib/contact.ts): change both together.

export const LEAD_TOPICS = ['sales', 'club'] as const
export const SUPPORT_TOPICS = ['account', 'billing', 'bug', 'complaint', 'feedback', 'other'] as const
export const CONTACT_TOPICS = [...LEAD_TOPICS, ...SUPPORT_TOPICS] as const

export type ContactTopic = (typeof CONTACT_TOPICS)[number]
export type ContactBox = 'leads' | 'support'

export function boxFor(topic: string | null | undefined): ContactBox {
  return !topic || (LEAD_TOPICS as readonly string[]).includes(topic) ? 'leads' : 'support'
}

/** The Prisma `where` for one inbox. NULL topics are leads (see the migration). */
export function boxWhere(box: ContactBox) {
  return box === 'support'
    ? { topic: { in: [...SUPPORT_TOPICS] } }
    : { OR: [{ topic: null }, { topic: { in: [...LEAD_TOPICS] } }] }
}

/** Shown in the support email's subject, so the inbox can be scanned. */
export const TOPIC_LABEL: Record<ContactTopic, string> = {
  sales: 'Pricing or demo',
  club: 'Club or partnership',
  account: 'Account or login',
  billing: 'Billing',
  bug: 'Something is not working',
  complaint: 'Complaint',
  feedback: 'Idea or feedback',
  other: 'Other',
}
