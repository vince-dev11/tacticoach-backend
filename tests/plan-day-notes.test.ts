// SEASON-5 · a title and a description per day of a season week.
import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import { getPlan } from '../src/modules/plans/plans.service.js'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function access() {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}
function ownedWeek(dayNotes: unknown = null) {
  dbMock.planWeek.findFirst.mockResolvedValue({ id: 3, startDate: d('2026-09-28'), dayNotes, plan: { weekStartsOn: 1 } } as never)
  dbMock.planWeek.update.mockResolvedValue({} as never)
}
const patch = async (payload: unknown) => {
  const app = await getApp()
  return app.inject({ method: 'PATCH', url: '/api/plans/weeks/3', headers: authHeaders(await accessToken()), payload })
}
const written = () => (dbMock.planWeek.update.mock.calls.at(-1)![0] as { data: { dayNotes?: unknown } }).data.dayNotes

describe('PATCH /plans/weeks/:id · dayNote', () => {
  it('sets one day, keeping the others', async () => {
    access()
    ownedWeek({ '2026-09-29': { title: 'Gym', description: '' } })
    await patch({ dayNote: { date: '2026-09-28', title: ' Recovery ', description: 'Light jog and stretch' } })
    expect(written()).toEqual({
      '2026-09-29': { title: 'Gym', description: '' },
      '2026-09-28': { title: 'Recovery', description: 'Light jog and stretch' },
    })
  })

  it('clears a day when both are blank', async () => {
    access()
    ownedWeek({ '2026-09-28': { title: 'Recovery', description: '' } })
    await patch({ dayNote: { date: '2026-09-28', title: '', description: '  ' } })
    expect(written()).toEqual({})
  })

  it('refuses a day outside the week, and a title that is too long', async () => {
    access()
    ownedWeek()
    expect((await patch({ dayNote: { date: '2026-10-05', title: 'x' } })).statusCode).toBe(422)
    expect((await patch({ dayNote: { date: '2026-09-28', title: 'x'.repeat(81) } })).statusCode).toBe(422)
  })

  it("someone else's week is 404", async () => {
    access()
    dbMock.planWeek.findFirst.mockResolvedValue(null as never)
    expect((await patch({ dayNote: { date: '2026-09-28', title: 'x' } })).statusCode).toBe(404)
  })
})

describe('the season view carries the day notes', () => {
  it('only this week\'s days', async () => {
    dbMock.seasonPlan.findFirst.mockResolvedValue({
      id: 1, title: 'U15', ageGroup: null, seasonLabel: null, startDate: d('2026-09-28'), weekStartsOn: 1,
      weeks: [{ id: 3, weekIndex: 1, startDate: d('2026-09-28'), theme: null, phase: 'pre-season', sessions: [],
        dayNotes: { '2026-09-28': { title: 'Recovery', description: 'Light' }, '2026-12-25': { title: 'stray', description: '' } } }],
    } as never)
    const plan = await getPlan(1, 1)
    expect(plan!.weeks[0].dayNotes).toEqual({ '2026-09-28': { title: 'Recovery', description: 'Light' } })
  })
})
