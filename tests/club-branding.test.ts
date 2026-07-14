// Club branding — brand kit CRUD, eligibility gate, submission, CRM approval
// and the public club page.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)

beforeEach(() => {
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
})
afterEach(() => mailConfigured.mockReturnValue(false))

const clubPlanSub = () =>
  activeSubscription({ plan: { id: 3, name: 'Club', slug: 'club', maxTeamMembers: 10 } })

function clubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ownerId: 1,
    name: 'FC United',
    badgeKey: 'clubs/1/badge.png',
    primaryColor: '#fbbf24',
    secondaryColor: '#111111',
    slug: 'fc-united',
    bio: 'Grassroots club.',
    pageStatus: 'none',
    pageSubmittedAt: null,
    pageReviewNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Owner with active club plan + verified email. */
function mockEligibleOwner(publishedBoards = 2, publishedSheets = 1) {
  dbMock.userSubscription.findUnique.mockResolvedValue(clubPlanSub() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.user.findUniqueOrThrow.mockResolvedValue(userRow({ emailVerifiedAt: new Date() }) as never)
  dbMock.clubMember.findMany.mockResolvedValue([] as never)
  dbMock.canvasBoard.count.mockResolvedValue(publishedBoards as never)
  dbMock.drillSheet.count.mockResolvedValue(publishedSheets as never)
}

describe('branding settings', () => {
  it('returns brand kit + eligibility checklist', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow() as never)
    dbMock.clubPhoto.findMany.mockResolvedValue([] as never)
    mockEligibleOwner(2, 1)

    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/branding',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.badgeUrl).toContain('signed')
    expect(body.eligibility).toMatchObject({
      planActive: true,
      emailVerified: true,
      publishedCount: 3,
      publishedRequired: 3,
      eligible: true,
    })
  })

  it('rejects reserved slugs and duplicate slugs', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow() as never)

    const reserved = await app.inject({
      method: 'PATCH',
      url: '/api/clubs/branding',
      headers: authHeaders(await accessToken()),
      payload: { slug: 'admin' },
    })
    expect(reserved.statusCode).toBe(422)

    dbMock.club.findFirst.mockResolvedValue({ id: 99 } as never) // taken
    const dupe = await app.inject({
      method: 'PATCH',
      url: '/api/clubs/branding',
      headers: authHeaders(await accessToken()),
      payload: { slug: 'taken-club' },
    })
    expect(dupe.statusCode).toBe(409)
  })

  it('validates colours as hex', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow() as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/clubs/branding',
      headers: authHeaders(await accessToken()),
      payload: { primaryColor: 'gold' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('submission gate', () => {
  it('blocks submission when the content gate is not met', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow() as never)
    mockEligibleOwner(1, 0) // only 1 published item

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/branding/submit',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().eligibility.publishedCount).toBe(1)
  })

  it('blocks submission without badge or slug', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow({ badgeKey: null }) as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/branding/submit',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(422)
  })

  it('moves an eligible club to pending', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue(clubRow() as never)
    mockEligibleOwner(3, 1)
    dbMock.club.update.mockResolvedValue(clubRow({ pageStatus: 'pending' }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/branding/submit',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pageStatus).toBe('pending')
    expect(dbMock.club.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pageStatus: 'pending' }) }),
    )
  })
})

describe('CRM approvals', () => {
  function ownerRole() {
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
  }

  it('lists the pending queue with content counts', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.club.findMany.mockResolvedValue([
      { ...clubRow({ pageStatus: 'pending', pageSubmittedAt: new Date() }), owner: { id: 1, name: 'V', surname: 'C', email: 'v@c.dev' }, members: [] },
    ] as never)
    dbMock.canvasBoard.count.mockResolvedValue(3 as never)
    dbMock.drillSheet.count.mockResolvedValue(1 as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/club-pages',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json()
    expect(rows[0].publishedBoards).toBe(3)
    expect(rows[0].badgeUrl).toContain('signed')
  })

  it('approve → emails the owner with the live page link', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.club.findUnique.mockResolvedValue({
      ...clubRow({ pageStatus: 'pending' }),
      owner: { name: 'Vince', email: 'vince@test.dev' },
    } as never)
    dbMock.club.update.mockResolvedValue(clubRow({ pageStatus: 'approved' }) as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/club-pages/1',
      headers: authHeaders(await accessToken()),
      payload: { action: 'approve' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pageStatus).toBe('approved')
    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.to).toBe('vince@test.dev')
    expect(mail.html).toContain('/c/fc-united')
  })

  it('reject requires a note and emails it to the owner', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.club.findUnique.mockResolvedValue({
      ...clubRow({ pageStatus: 'pending' }),
      owner: { name: 'Vince', email: 'vince@test.dev' },
    } as never)

    const noNote = await app.inject({
      method: 'PATCH',
      url: '/api/admin/club-pages/1',
      headers: authHeaders(await accessToken()),
      payload: { action: 'reject' },
    })
    expect(noNote.statusCode).toBe(422)

    dbMock.club.update.mockResolvedValue(clubRow({ pageStatus: 'rejected' }) as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/club-pages/1',
      headers: authHeaders(await accessToken()),
      payload: { action: 'reject', note: 'Badge image is unreadable — please upload a larger one.' },
    })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalled())
    expect(sendMailMock.mock.calls[0][0].text).toContain('unreadable')
  })

  it('non-owners cannot touch the queue', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/club-pages',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('public club page', () => {
  it('serves an approved page with content from all coaches', async () => {
    const app = await getApp()
    dbMock.club.findFirst.mockResolvedValue({
      ...clubRow({ pageStatus: 'approved' }),
      owner: { id: 1, name: 'Vince', surname: 'Coach' },
      members: [{ user: { id: 2, name: 'Alex', surname: 'M' } }],
      photos: [],
    } as never)
    dbMock.canvasBoard.findMany.mockResolvedValue([
      {
        id: 7, title: 'High press', thumbnailKey: null, videoKey: 'v.mp4', publishedAt: new Date(),
        user: { name: 'Alex', surname: 'M' }, _count: { likes: 2 },
      },
    ] as never)
    dbMock.drillSheet.findMany.mockResolvedValue([] as never)

    const res = await app.inject({ method: 'GET', url: '/api/c/fc-united' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe('FC United')
    expect(body.coaches).toHaveLength(2)
    expect(body.boards[0].hasVideo).toBe(true)
    expect(dbMock.club.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'fc-united', pageStatus: 'approved' } }),
    )
  })

  it('404s pending/rejected/unknown pages', async () => {
    const app = await getApp()
    dbMock.club.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/c/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('branded share strip', () => {
  it('share board includes the club strip when the author club has a badge', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue({
      id: 7, userId: 5, title: 'High press', publishedAt: new Date(),
      thumbnailKey: null, videoKey: null,
      user: { name: 'Alex', surname: 'M', clubName: null },
      _count: { likes: 0 },
    } as never)
    dbMock.user.findUnique.mockResolvedValue({
      ownedClub: null,
      clubMembership: { club: { name: 'FC United', badgeKey: 'clubs/1/badge.png', primaryColor: '#fbbf24', slug: 'fc-united', pageStatus: 'approved' } },
    } as never)

    const res = await app.inject({ method: 'GET', url: '/api/share/board/7' })
    expect(res.statusCode).toBe(200)
    const { club } = res.json()
    expect(club.name).toBe('FC United')
    expect(club.badgeUrl).toContain('signed')
    expect(club.slug).toBe('fc-united')
  })

  it('omits the public-page link while the page is not approved', async () => {
    const app = await getApp()
    dbMock.canvasBoard.findFirst.mockResolvedValue({
      id: 7, userId: 5, title: 'x', publishedAt: new Date(), thumbnailKey: null, videoKey: null,
      user: { name: 'A', surname: 'M', clubName: null }, _count: { likes: 0 },
    } as never)
    dbMock.user.findUnique.mockResolvedValue({
      ownedClub: { name: 'FC United', badgeKey: 'clubs/1/badge.png', primaryColor: null, slug: 'fc-united', pageStatus: 'pending' },
      clubMembership: null,
    } as never)

    const res = await app.inject({ method: 'GET', url: '/api/share/board/7' })
    expect(res.json().club.slug).toBeNull()
  })
})

describe('gallery photos', () => {
  it('caps the gallery at 8 photos', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue({ id: 1 } as never)
    dbMock.clubPhoto.count.mockResolvedValue(8 as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/branding/photos',
      headers: { ...authHeaders(await accessToken()), 'content-type': 'multipart/form-data; boundary=x' },
      payload: '--x--',
    })
    expect(res.statusCode).toBe(422)
  })

  it('updates captions and deletes photos with ownership scoping', async () => {
    const app = await getApp()
    dbMock.club.findUnique.mockResolvedValue({ id: 1 } as never)
    dbMock.clubPhoto.updateMany.mockResolvedValue({ count: 1 } as never)

    const cap = await app.inject({
      method: 'PATCH',
      url: '/api/clubs/branding/photos/5',
      headers: authHeaders(await accessToken()),
      payload: { caption: 'U16 County Cup winners 2025' },
    })
    expect(cap.statusCode).toBe(200)
    expect(dbMock.clubPhoto.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, clubId: 1 } }),
    )

    dbMock.clubPhoto.findFirst.mockResolvedValue({ id: 5, clubId: 1, imageKey: 'clubs/1/gallery/x.jpg' } as never)
    dbMock.clubPhoto.delete.mockResolvedValue({} as never)
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/clubs/branding/photos/5',
      headers: authHeaders(await accessToken()),
    })
    expect(del.statusCode).toBe(204)
  })

  it('public page includes the gallery with presigned urls', async () => {
    const app = await getApp()
    dbMock.club.findFirst.mockResolvedValue({
      ...{
        id: 1, ownerId: 1, name: 'FC United', badgeKey: null, primaryColor: null, secondaryColor: null,
        slug: 'fc-united', bio: null, location: 'Manchester', foundedYear: 1998,
        pageStatus: 'approved', pageSubmittedAt: null, pageReviewNote: null,
      },
      owner: { id: 1, name: 'V', surname: 'C' },
      members: [],
      photos: [{ id: 1, caption: 'County Cup 2025', imageKey: 'clubs/1/gallery/a.jpg', sortOrder: 0 }],
    } as never)
    dbMock.canvasBoard.findMany.mockResolvedValue([] as never)
    dbMock.drillSheet.findMany.mockResolvedValue([] as never)

    const res = await app.inject({ method: 'GET', url: '/api/c/fc-united' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.location).toBe('Manchester')
    expect(body.foundedYear).toBe(1998)
    expect(body.gallery[0].imageUrl).toContain('signed')
    expect(body.gallery[0].caption).toContain('County Cup')
  })
})
