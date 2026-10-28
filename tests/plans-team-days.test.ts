// SEASON-DAYS (27 Oct 2026, migration 62): a season remembers the days the
// team trains or plays; the season screen shows only those (null = every day).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'

describe('SEASON-DAYS', () => {
  it('migration 62 adds a nullable team_days column', () => {
    expect(readFileSync('prisma/migrations/62_season_team_days/migration.sql', 'utf8'))
      .toContain('ALTER TABLE `season_plans` ADD COLUMN `team_days` VARCHAR(20) NULL;')
  })

  it('PATCH stores the days sorted and unique, and [] clears them', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.seasonPlan.findFirst.mockResolvedValue({ id: 4 } as never)
    dbMock.seasonPlan.update.mockResolvedValue({} as never)
    const headers = authHeaders(await accessToken())
    await app.inject({ method: 'PATCH', url: '/api/plans/4', headers, payload: { teamDays: [6, 2, 4, 2] } })
    expect(dbMock.seasonPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ teamDays: '2,4,6' }) }))
    await app.inject({ method: 'PATCH', url: '/api/plans/4', headers, payload: { teamDays: [] } })
    expect(dbMock.seasonPlan.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ teamDays: null }) }))
    const bad = await app.inject({ method: 'PATCH', url: '/api/plans/4', headers, payload: { teamDays: [9] } })
    expect(bad.statusCode).toBe(422)
  })
})
