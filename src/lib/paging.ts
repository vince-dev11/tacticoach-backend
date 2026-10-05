// Page / limit from a list request's query string, clamped (5 Oct 2026).
//
// The lists used to pass `?limit=` straight to Prisma, so `?limit=100000`
// made one request load — and sign a media URL for — every row in the table.
// MAX_LIMIT is the largest page the app itself asks for (the library loads a
// coach's boards with limit=100).

export const MAX_LIMIT = 100

export function pageParams(
  query: unknown,
  defaults: { limit?: number; max?: number } = {},
): { page: number; limit: number; skip: number } {
  const q = (query ?? {}) as Record<string, string | undefined>
  const max = defaults.max ?? MAX_LIMIT
  const def = defaults.limit ?? 20
  const rawLimit = Math.floor(Number(q.limit))
  const rawPage = Math.floor(Number(q.page))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(max, rawLimit) : def
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1
  return { page, limit, skip: (page - 1) * limit }
}
