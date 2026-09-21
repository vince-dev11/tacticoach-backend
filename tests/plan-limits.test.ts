// The two limits that are metered rather than gated.
//
// Every other tier difference is a yes/no in `capabilities.ts` and is tested
// there. These two are counted, which makes them the only places a coach can
// be *inside* their plan and still be told no — and the only places where an
// off-by-one or a wrong window is worth real money in either direction.
//
// What these tests are actually defending:
//   - the cap is enforced where the row is created, not in the route, so no
//     other caller can route around it;
//   - "ten a month" means a calendar month, the same month a coach would
//     count on their own;
//   - a failed export does not consume one;
//   - Pro never touches the counter at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import type { Entitlements } from '../src/lib/entitlements.js'

const getEntitlements = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/entitlements.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/entitlements.js')>()),
  getEntitlements,
}))

const { createSquad } = await import('../src/modules/users/squads.service.js')
const { videoQuota, recordVideoExport } = await import('../src/lib/video-quota.js')

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** A coach on `slug`, holding an active subscription. */
const on = (slug: string | null, over: Partial<Entitlements> = {}): Entitlements => ({
  editorAccess: slug !== null,
  playerAccess: false,
  plan: slug ? { id: 1, name: slug, slug } : null,
  viaClub: false,
  viaPartner: false,
  isClubOwner: false,
  subscriptionStatus: slug ? 'active' : null,
  expiresAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mock.squad.create.mockResolvedValue({ id: 9, name: 'New squad' })
})

// ---------------------------------------------------------------------------
// Squads: Basic 1, Pro unlimited
// ---------------------------------------------------------------------------

describe('the squad cap', () => {
  it('lets a Basic coach create their first squad', async () => {
    getEntitlements.mockResolvedValue(on('basic'))
    mock.squad.count.mockResolvedValue(0)

    await expect(createSquad(7, 'U13s', null)).resolves.toMatchObject({ id: 9 })
    expect(mock.squad.create).toHaveBeenCalled()
  })

  it('refuses the second, with a 402 the UI can turn into an upgrade prompt', async () => {
    getEntitlements.mockResolvedValue(on('basic'))
    mock.squad.count.mockResolvedValue(1)

    // 402 rather than 403: the coach is not forbidden, they are un-upgraded.
    // The distinction is what lets one handler show a price instead of an
    // apology.
    await expect(createSquad(7, 'U15s', null)).rejects.toMatchObject({ statusCode: 402 })
  })

  it('never writes the row it is refusing', async () => {
    // The check sits above the create in the SERVICE, so it holds for any
    // caller — an admin tool, a future import, a second route. Enforcing it in
    // the route would protect exactly one entry point.
    getEntitlements.mockResolvedValue(on('basic'))
    mock.squad.count.mockResolvedValue(1)

    await createSquad(7, 'U15s', null).catch(() => undefined)

    expect(mock.squad.create).not.toHaveBeenCalled()
  })

  it('says what the upgrade buys, not what the coach did wrong', async () => {
    getEntitlements.mockResolvedValue(on('basic'))
    mock.squad.count.mockResolvedValue(1)

    await expect(createSquad(7, 'U15s', null)).rejects.toThrow(/Upgrade to Pro/i)
  })

  it('counts only live squads, so archiving one frees the slot', async () => {
    // A coach who retires last season's team and starts this season's would
    // otherwise be permanently stuck at one squad they no longer use.
    getEntitlements.mockResolvedValue(on('basic'))
    mock.squad.count.mockResolvedValue(0)

    await createSquad(7, 'U15s', null)

    expect(mock.squad.count).toHaveBeenCalledWith({ where: { userId: 7, archivedAt: null } })
  })

  it('does not cap Pro', async () => {
    getEntitlements.mockResolvedValue(on('pro'))
    mock.squad.count.mockResolvedValue(40)

    await expect(createSquad(7, 'U18s', null)).resolves.toMatchObject({ id: 9 })
  })

  it('does not cap a coach on a club seat', async () => {
    // Club seats resolve through the owner's plan. A club coach finding
    // themselves on a one-squad limit would be the clearest possible sign
    // that seat entitlements had quietly stopped resolving.
    getEntitlements.mockResolvedValue(on('club-5', { viaClub: true }))
    mock.squad.count.mockResolvedValue(6)

    await expect(createSquad(7, 'U16s', null)).resolves.toMatchObject({ id: 9 })
  })
})

// ---------------------------------------------------------------------------
// Video: Basic 10 a month at 720p, Pro unlimited HD
// ---------------------------------------------------------------------------

describe('the monthly video quota', () => {
  const exportsMock = () => mock.videoExport

  it('reports the remaining exports for a Basic coach', async () => {
    getEntitlements.mockResolvedValue(on('basic'))
    exportsMock().count.mockResolvedValue(3)

    expect(await videoQuota(7)).toMatchObject({
      limit: 10, used: 3, remaining: 7, allowed: true, hd: false,
    })
  })

  it('allows the tenth and refuses the eleventh', async () => {
    // The off-by-one that would either give away an extra export every month
    // or charge a coach for one they never got.
    getEntitlements.mockResolvedValue(on('basic'))

    exportsMock().count.mockResolvedValue(9)
    expect((await videoQuota(7)).allowed).toBe(true)

    exportsMock().count.mockResolvedValue(10)
    const spent = await videoQuota(7)
    expect(spent.allowed).toBe(false)
    expect(spent.remaining).toBe(0)
  })

  it('never reports negative remaining, even if the count overshoots', async () => {
    // It can overshoot: the ledger is written after a successful upload, and
    // two exports finishing at once both pass the check first. Better to let
    // a coach have an eleventh occasionally than to render "-1 remaining".
    getEntitlements.mockResolvedValue(on('basic'))
    exportsMock().count.mockResolvedValue(12)

    expect((await videoQuota(7)).remaining).toBe(0)
  })

  it('counts a calendar month, not a rolling thirty days', async () => {
    // "You get ten a month" has to mean the month on the coach's wall. With a
    // rolling window their tenth export comes back on a different day each
    // time, which is unexplainable at support.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-18T14:00:00Z'))
    getEntitlements.mockResolvedValue(on('basic'))
    exportsMock().count.mockResolvedValue(2)

    await videoQuota(7)

    const { where } = exportsMock().count.mock.calls[0][0]
    expect(where.userId).toBe(7)
    expect((where.createdAt.gte as Date).toISOString()).toBe('2026-03-01T00:00:00.000Z')
    vi.useRealTimers()
  })

  it('resets on the first of the month rather than being reset by a job', async () => {
    // Nothing runs at midnight on the 1st. The window moves because it is
    // computed, which is the whole reason this is a ledger and not a counter:
    // a counter needs a cron job, and a cron job that fails silently bills
    // coaches for exports they did last month.
    vi.useFakeTimers()
    getEntitlements.mockResolvedValue(on('basic'))
    exportsMock().count.mockImplementation(async (args: any) =>
      // Ten exports, all on the 28th of February.
      args.where.createdAt.gte <= new Date('2026-02-28T00:00:00Z') ? 10 : 0,
    )

    vi.setSystemTime(new Date('2026-02-28T23:00:00Z'))
    expect((await videoQuota(7)).allowed).toBe(false)

    vi.setSystemTime(new Date('2026-03-01T00:30:00Z'))
    expect((await videoQuota(7)).allowed).toBe(true)
    vi.useRealTimers()
  })

  it('does not query the ledger at all for Pro', async () => {
    // Unlimited means unlimited: an unnecessary count on every export is a
    // query per export for a number nobody reads.
    getEntitlements.mockResolvedValue(on('pro'))

    expect(await videoQuota(7)).toMatchObject({ limit: null, remaining: null, allowed: true, hd: true })
    expect(exportsMock().count).not.toHaveBeenCalled()
  })

  it('gives a lapsed subscription nothing, even though the plan row remains', async () => {
    getEntitlements.mockResolvedValue(on('pro', { editorAccess: false, subscriptionStatus: 'expired' }))
    exportsMock().count.mockResolvedValue(0)

    const quota = await videoQuota(7)
    expect(quota.limit).toBe(0)
    expect(quota.allowed).toBe(false)
    expect(quota.hd).toBe(false)
  })

  it('marks Basic as non-HD and Pro as HD', async () => {
    // The same call answers "may they?" and "at what quality?", so a route
    // cannot check one and forget the other.
    getEntitlements.mockResolvedValue(on('basic'))
    exportsMock().count.mockResolvedValue(0)
    expect((await videoQuota(7)).hd).toBe(false)

    getEntitlements.mockResolvedValue(on('club-10'))
    expect((await videoQuota(7)).hd).toBe(true)
  })
})

describe('recording an export', () => {
  it('stores the plan in force at the time', async () => {
    // Without it, a coach who upgrades mid-month has no record of why they
    // were capped last week — and neither does support.
    mock.videoExport.create.mockResolvedValue({ id: 1 })

    await recordVideoExport(7, 42, 'basic')

    expect(mock.videoExport.create).toHaveBeenCalledWith({
      data: { userId: 7, boardId: 42, planSlug: 'basic' },
    })
  })

  it('swallows a failure rather than failing the export the coach waited for', async () => {
    // Under-counting is the cheaper mistake. Losing a finished video because
    // the meter could not be written is not.
    mock.videoExport.create.mockRejectedValue(new Error('db gone'))

    await expect(recordVideoExport(7, 42, 'basic')).resolves.toBeUndefined()
  })
})

afterEach(() => vi.useRealTimers())
