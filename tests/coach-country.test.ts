// COACH-COUNTRY (26 Oct 2026) — "Country you coach in": the coach's own, and a
// club default its coaches start from (the coach's own wins). Suggestions only.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow } from './helpers.js'
import { COUNTRY_CODES, UK_NATIONS, isCountryCode } from '../src/lib/countries.js'
import { UpdateProfileSchema } from '../src/modules/users/users.schema.js'
import { clubCountryFor } from '../src/modules/users/users.service.js'

describe('COACH-COUNTRY · the country list', () => {
  it('has the four UK football nations instead of GB, and the ISO countries', () => {
    expect(UK_NATIONS).toEqual(['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'])
    expect(COUNTRY_CODES).not.toContain('GB')
    for (const c of ['BR', 'US', 'DE', 'NL', 'ES', 'PT', 'FR', 'IT', 'TR', 'IN', 'IE']) expect(isCountryCode(c), c).toBe(true)
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
  })

  it('is the same list as the web app', () => {
    const web = readFileSync('../tacticoach-frontend/src/lib/countries.ts', 'utf8')
    const api = readFileSync('src/lib/countries.ts', 'utf8')
    const block = (s: string) => s.slice(s.indexOf('const ISO = ('), s.indexOf(").split(' ')"))
    expect(block(web)).toBe(block(api))
  })

  it('migration 59 adds a nullable column on users and on clubs', () => {
    const sql = readFileSync('prisma/migrations/59_coaching_country/migration.sql', 'utf8')
    expect(sql).toContain('ALTER TABLE `users` ADD COLUMN `coach_country` VARCHAR(8) NULL;')
    expect(sql).toContain('ALTER TABLE `clubs` ADD COLUMN `country` VARCHAR(8) NULL;')
  })
})

describe('COACH-COUNTRY · a coach sets their own', () => {
  it('the profile accepts a country code, clears with "", rejects anything else', () => {
    expect(UpdateProfileSchema.parse({ coachCountry: 'BR' }).coachCountry).toBe('BR')
    expect(UpdateProfileSchema.parse({ coachCountry: 'GB-ENG' }).coachCountry).toBe('GB-ENG')
    expect(UpdateProfileSchema.parse({ coachCountry: '' }).coachCountry).toBeNull()
    expect(UpdateProfileSchema.safeParse({ coachCountry: 'GB' }).success).toBe(false)
    expect(UpdateProfileSchema.safeParse({ coachCountry: 'Brazil' }).success).toBe(false)
  })
})

describe('COACH-COUNTRY · the club default', () => {
  it('a club owner gets their club’s country; a member gets their club’s; nobody else gets one', async () => {
    dbMock.club.findUnique.mockResolvedValueOnce({ country: 'BR' } as never)
    expect(await clubCountryFor(1)).toBe('BR')

    dbMock.club.findUnique.mockResolvedValueOnce(null)
    dbMock.clubMember.findUnique.mockResolvedValueOnce({ club: { country: 'NL' } } as never)
    expect(await clubCountryFor(2)).toBe('NL')

    dbMock.club.findUnique.mockResolvedValueOnce(null)
    dbMock.clubMember.findUnique.mockResolvedValueOnce(null)
    expect(await clubCountryFor(3)).toBeNull()
  })

  it('PATCH /clubs/country: the owner sets and clears it', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)
    dbMock.club.findUnique.mockResolvedValue({ id: 7 } as never)
    dbMock.club.update.mockResolvedValue({ country: 'BR' } as never)
    const res = await app.inject({
      method: 'PATCH', url: '/api/clubs/country', headers: authHeaders(await accessToken()), payload: { country: 'BR' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ country: 'BR' })
    expect(dbMock.club.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 }, data: { country: 'BR' } }))

    dbMock.club.update.mockResolvedValue({ country: null } as never)
    const cleared = await app.inject({
      method: 'PATCH', url: '/api/clubs/country', headers: authHeaders(await accessToken()), payload: { country: null },
    })
    expect(cleared.json()).toEqual({ country: null })
  })

  it('PATCH /clubs/country: a coach who does not own the club is refused, and a bad code is a 422', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)
    dbMock.club.findUnique.mockResolvedValue(null)
    const notOwner = await app.inject({
      method: 'PATCH', url: '/api/clubs/country', headers: authHeaders(await accessToken()), payload: { country: 'BR' },
    })
    expect(notOwner.statusCode).toBe(404)
    expect(dbMock.club.update).not.toHaveBeenCalled()

    dbMock.club.findUnique.mockResolvedValue({ id: 7 } as never)
    const bad = await app.inject({
      method: 'PATCH', url: '/api/clubs/country', headers: authHeaders(await accessToken()), payload: { country: 'Brazil' },
    })
    expect(bad.statusCode).toBe(422)
  })
})
