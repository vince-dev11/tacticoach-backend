// A reminder that deletes itself.
//
// `src/modules/referrals/prisma-shim.ts` exists only because the checked-in
// Prisma client still describes the referral tables as they were before
// migration 17 was reshaped — two-value enums, no payment columns. It is a
// type-level lie, told deliberately, and a lie nobody is reminded of is a lie
// that outlives its reason.
//
// So: the moment `prisma generate` runs against the current schema, this test
// FAILS, and the failure says what to do. That is the whole point of it. It is
// not testing the shim; it is testing that the shim is still needed.

import { describe, it, expect } from 'vitest'
import { clientHasNewReferralFields } from '../src/modules/referrals/prisma-shim.js'

describe('the TEMPORARY Prisma shim', () => {
  it('is still needed — delete it when this fails', () => {
    expect(
      clientHasNewReferralFields(),
      [
        '',
        'The generated Prisma client now knows about `referrerPlan`, which means',
        'the shim has done its job. Remove it:',
        '',
        '  1. delete src/modules/referrals/prisma-shim.ts',
        '  2. in referrals.service.ts and referral-credit.service.ts, change',
        '     referralDb() -> db.referral and referralRewardDb() -> db.referralReward,',
        '     and drop the two shim imports',
        '  3. delete this test file',
        '',
        'The row types in the shim are exactly what the client generates, so',
        'nothing else should need touching.',
      ].join('\n'),
    ).toBe(false)
  })
})
