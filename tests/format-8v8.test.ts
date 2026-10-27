// FORMAT-8V8 (26 Oct 2026) — a coach whose team plays 8v8 (France, Spain,
// the Netherlands, Turkey at U11–U12) could draw an 8v8 board but could not
// save "8-a-side" as their format: the profile, the AI context and the book
// filter only knew 5/7/9/11.
import { describe, it, expect } from 'vitest'
import { FORMAT_PROFILES, FORMATIONS_BY_FORMAT, isPlayFormat, isFormationForFormat } from '../src/modules/ai/ai.context.js'
import { UpdateProfileSchema } from '../src/modules/users/users.schema.js'
import { FORMATS as BOOK_FORMATS } from '../src/modules/ebooks/ebooks.service.js'

describe('FORMAT-8V8 · 8v8 is a format a coach can choose', () => {
  it('the profile accepts and stores coachFormat "8v8"', () => {
    const parsed = UpdateProfileSchema.safeParse({ coachFormat: '8v8' })
    expect(parsed.success).toBe(true)
    expect(UpdateProfileSchema.safeParse({ coachFormat: '6v6' }).success).toBe(false)
  })

  it('the AI context knows 8 a side, keepers, and the board\'s 8v8 pitch', () => {
    expect(isPlayFormat('8v8')).toBe(true)
    expect(FORMAT_PROFILES['8v8']).toEqual({ label: '8-a-side', perTeam: 8, pitchKey: 'pitch_8v8', keepers: true })
  })

  it('its formations are the board\'s 8v8 shapes, each 7 outfield + keeper', () => {
    expect(FORMATIONS_BY_FORMAT['8v8']).toEqual(['3-3-1', '3-2-2', '2-3-2'])
    for (const f of FORMATIONS_BY_FORMAT['8v8']) {
      expect(f.split('-').map(Number).reduce((a, b) => a + b, 0), f).toBe(7)
      expect(isFormationForFormat(f, '8v8')).toBe(true)
    }
    expect(isFormationForFormat('4-3-3', '8v8')).toBe(false)
  })

  it('a book can be tagged 8v8', () => {
    expect(BOOK_FORMATS).toContain('8v8')
  })
})
