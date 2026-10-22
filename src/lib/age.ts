// FAMILY (12 Oct 2026) — a player's age, from the date of birth their coach
// entered. Two thresholds, both the owner's rule (see the plan in
// docs/briefs/Plan_Books_And_Family_Accounts_2026-10-12.md):
//
//   - under 13: no login of their own; the parent's account is the window.
//     (13 is the UK / US age of digital consent; it varies 13–16 across the
//     EU — one constant, so a country rule can change it in one place.)
//   - under 18: a parent account is required and must consent first; never a
//     price or a Buy button.

export const OWN_LOGIN_AGE = 13
export const ADULT_AGE = 18

/** Whole years on `now` (birthdays count from the day itself). Dates are calendar dates (UTC). */
export function ageOn(dob: Date, now: Date = new Date()): number {
  const y = now.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  return beforeBirthday ? y - 1 : y
}

/**
 * Is this account a child for money and consent purposes?
 *
 * A player with no date of birth yet (signed up before coaches entered one) is
 * treated as a child: the safe answer while their coach has not said.
 */
export function isMinorAccount(user: { accountType: string; dateOfBirth: Date | null }, now: Date = new Date()): boolean {
  if (user.accountType !== 'player') return false
  return !user.dateOfBirth || ageOn(user.dateOfBirth, now) < ADULT_AGE
}

/** "2014-05-21" → a UTC date, or null when it is not a real calendar date. */
export function parseDob(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null
}
