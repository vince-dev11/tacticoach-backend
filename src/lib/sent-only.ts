// What did the caller ACTUALLY send?
//
// `Schema.partial().parse(body)` does not answer that question, and the way it
// fails is quiet. `.partial()` makes every field optional, but it does not
// remove the `.default()` on a field, so a schema like
//
//     z.object({ language: z.string().default('en'), status: z.enum(...).default('draft') })
//
// parsed from `{ blurb: 'x' }` comes back as
//
//     { blurb: 'x', language: 'en', status: 'draft' }
//
// Spread into a Prisma `update`, that PATCH re-languages a Spanish book to
// English and pulls a published book back to draft — from a request that only
// touched the blurb. Nothing errors; the book is simply wrong afterwards.
//
// So: parse for validation, then keep only the keys the request body actually
// carried. Defaults still do their job on create, where "unset" really does
// mean "use the default".

/**
 * The validated fields the caller sent, with schema defaults for untouched
 * fields dropped.
 *
 * `body` is the raw request body. A non-object body (or none) yields `{}` —
 * there is nothing to patch.
 */
export function sentOnly<T extends object>(parsed: T, body: unknown): Partial<T> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const sent = new Set(Object.keys(body as Record<string, unknown>))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (sent.has(key)) out[key] = value
  }
  return out as Partial<T>
}

/** Did the request touch any field other than the ones named? */
export function touchesMoreThan(body: unknown, ...allowed: string[]): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  return Object.keys(body as Record<string, unknown>).some((k) => !allowed.includes(k))
}
