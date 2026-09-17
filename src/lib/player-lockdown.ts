// What a PLAYER account is allowed to call.
//
// A player is not a coach with fewer buttons and not a coach who has not paid
// — it is a different product. They author nothing: no boards, no animations,
// no drill sheets, no sessions, no season plans, no squad. They read what
// their coach wrote them and they manage their own account.
//
// DENY BY DEFAULT. This list is an allow-list, so a route added tomorrow is
// closed to players until somebody deliberately opens it. The opposite shape —
// a list of things players may NOT touch — was the alternative, and it fails
// the moment a new module ships: the person adding it has no reason to think
// about players at all, and nothing tells them they were supposed to.
//
// Why this exists at all, given `requireEditorAccess`:
//
//   1. It is not on every route. Of roughly a hundred routes, about half carry
//      an editor guard; challenges, clubs, the coach page and a good number of
//      canvas and planner reads carry none.
//   2. Until now it would not have helped anyway. Every signup is given a
//      7-day full-access trial, players included, so a new player account had
//      `editorAccess: true` for its first week and the whole coach product was
//      open to it. That is fixed in entitlements and at register, and this
//      list is the belt to that pair of braces.
//
// Being denied here is not about money and must never be reported as though it
// were: there is no plan a player can buy to unlock the editor, because the
// editor is not for them.

/**
 * Exact paths a player may call. Exact, not prefixed, because the near
 * neighbours are all coach-only: /api/users/me is the player's own profile,
 * while /api/users/me/squad, /me/squads and /me/logo are a coach's roster and
 * club branding.
 */
const ALLOWED_EXACT: readonly string[] = [
  '/api/users/me',
  '/api/users/me/tours',
  // Read-only billing. A player has nothing to buy — /checkout is deliberately
  // absent — but /entitlements is what the client uses to decide where to send
  // them, so refusing it would break their own screens.
  '/api/membership/plans',
  '/api/membership/my',
  '/api/membership/entitlements',
]

/**
 * Prefixes a player may call.
 *
 * Every one ends in '/' on purpose. '/api/club/' is the PUBLIC club page
 * looked up by slug; '/api/clubs/' is club administration — seats, invites,
 * promoting admins. One character apart, opposite answers, and a prefix
 * written without the slash would have opened the second along with the first.
 */
const ALLOWED_PREFIXES: readonly string[] = [
  '/api/auth/',
  // Their entire product.
  '/api/feedback/',
  // The "watch the move" link in a note, and the drill sheet behind it. Public
  // to anyone with the id — a player reaching it is not a privilege escalation.
  '/api/share/',
  // Public marketing surfaces, reachable logged out by anyone.
  '/api/blog/',
  '/api/club/',
  '/api/contact/',
  // No user attached; the sender is Stripe.
  '/api/webhooks/',
]

/**
 * May a player account call this path?
 *
 * Takes a pathname with no query string — callers strip it. Trailing slashes
 * are normalised so /api/users/me/ cannot walk around an exact match.
 */
export function playerMayCall(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  if (ALLOWED_EXACT.includes(path)) return true
  // Compared against the slash-terminated path so '/api/blog' matches the
  // '/api/blog/' prefix, while '/api/blogsomething' does not.
  const terminated = `${path}/`
  return ALLOWED_PREFIXES.some((prefix) => terminated.startsWith(prefix))
}
