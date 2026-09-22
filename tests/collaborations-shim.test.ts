// A reminder that deletes itself — same job as tests/referrals-shim.test.ts.
//
// `src/modules/collaborations/prisma-shim.ts` exists only because the
// checked-in Prisma client still describes the partner tables: it has no
// `db.collaborator` at all, and no `coach_rate` / `club_rate`. It is a
// type-level lie, told deliberately, and a lie nobody is reminded of is a lie
// that outlives its reason.

import { describe, it, expect } from 'vitest'
import { clientHasCollaborators } from '../src/modules/collaborations/prisma-shim.js'

describe('the TEMPORARY collaboration Prisma shim', () => {
  it('is still needed — delete it when this fails', () => {
    expect(
      clientHasCollaborators(),
      [
        '',
        'The generated Prisma client now has `db.collaborator`, which means the',
        'shim has done its job. Remove it:',
        '',
        '  1. delete src/modules/collaborations/prisma-shim.ts',
        '  2. swap collaboratorDb() -> db.collaborator and commissionDb() ->',
        '     db.collaboratorCommission in collaborations.service.ts,',
        '     lib/entitlements.ts, modules/referrals/referrals.routes.ts and',
        '     modules/admin/admin.routes.ts, dropping the shim imports',
        '  3. drop the TEMPORARY cast on `u.collaborator` in admin.routes.ts',
        '  4. delete this test file',
        '',
      ].join('\n'),
    ).toBe(false)
  })
})
