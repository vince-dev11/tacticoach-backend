// The declared account type.
//
// The rule this file exists to protect: accountType is what the person SAID
// they are, and it grants nothing. Access is resolved by lib/entitlements
// (subscription + club seat + partner), and "is this really a club" is the
// Club row plus an active owner subscription. If someone ever wires this enum
// into an authorisation check, these tests should be the thing that argues.

import { describe, it, expect } from 'vitest'
import { RegisterSchema } from '../src/modules/auth/auth.schema.js'
import { UpdateProfileSchema } from '../src/modules/users/users.schema.js'

const base = {
  name: 'Alex',
  surname: 'Coach',
  email: 'alex@example.com',
  password: 'sufficiently-long-password',
}

describe('RegisterSchema.accountType', () => {
  it('defaults to coach when the client sends nothing', () => {
    // Every account that existed before the field was added is a coach, and so
    // is any older client that has not been rebuilt yet.
    expect(RegisterSchema.parse(base).accountType).toBe('coach')
  })

  it.each(['coach', 'club', 'player'] as const)('accepts %s', (accountType) => {
    expect(RegisterSchema.parse({ ...base, accountType }).accountType).toBe(accountType)
  })

  it.each(['owner', 'admin', 'parent', '', 'COACH'])('refuses %p', (accountType) => {
    expect(RegisterSchema.safeParse({ ...base, accountType }).success).toBe(false)
  })
})

describe('UpdateProfileSchema.accountType', () => {
  it('can be corrected later — solo coach who starts running a club', () => {
    expect(UpdateProfileSchema.parse({ accountType: 'club' }).accountType).toBe('club')
  })

  it('is optional, so a profile save that omits it changes nothing', () => {
    expect(UpdateProfileSchema.parse({ name: 'Alex' }).accountType).toBeUndefined()
  })

  it('cannot be used to award the owner role', () => {
    // `role` is assigned only from OWNER_EMAIL at registration; the profile
    // endpoint must not be a second door to it.
    expect(UpdateProfileSchema.safeParse({ accountType: 'owner' }).success).toBe(false)
    expect('role' in UpdateProfileSchema.parse({ name: 'Alex' })).toBe(false)
  })
})
