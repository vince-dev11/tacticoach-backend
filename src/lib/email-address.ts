// EMAIL-FAIL (14 Oct 2026): is this address something we can email?
//
// A send with no usable address used to reach the SMTP server, which answered
// "No recipients defined": a Sentry error, and no line an admin could act on.
// sendMail now checks first, records the failure with a plain reason, and
// Admin → Users shows it next to the person.
//
// Kept apart from config/mailer.ts (no nodemailer, no database) so the admin
// routes can use it and the tests' global mailer mock does not hide it.

/** The bare address inside "Name <addr>" (or the string itself). */
export const bareAddress = (a: string) => (a.match(/<([^>]+)>/)?.[1] ?? a).trim().toLowerCase()

// Deliberately loose: it catches blanks and garbage ("sam@gmail", "a b@c.d"),
// never second-guesses a real address. The provider is the real judge.
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:.]+$/

export const NO_ADDRESS = 'No email address'
export const BAD_ADDRESS = 'Not a valid email address'

/** Why this recipient cannot be emailed, or null when it looks deliverable. */
export function recipientProblem(to: string | null | undefined): string | null {
  if (!to || !to.trim()) return NO_ADDRESS
  return ADDRESS.test(bareAddress(to)) ? null : BAD_ADDRESS
}

/** Thrown by sendMail (after the failure is recorded) when the address itself is the problem. */
export class InvalidRecipientError extends Error {
  readonly code = 'INVALID_RECIPIENT'
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRecipientError'
  }
}

export function isInvalidRecipient(err: unknown): err is InvalidRecipientError {
  return (err as { code?: string } | null)?.code === 'INVALID_RECIPIENT'
}
