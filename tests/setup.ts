// Global test setup — replaces the real Prisma client and S3 helpers with
// mocks so route tests run without MySQL or AWS.

import { beforeEach, vi } from 'vitest'
import { mockDeep, mockReset } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

export const dbMock = mockDeep<PrismaClient>()

vi.mock('../src/config/database.js', () => ({ db: dbMock }))

vi.mock('../src/config/s3.js', () => ({
  uploadToS3: vi.fn(async (key: string) => key),
  deleteFromS3: vi.fn(async () => {}),
  presignUrl: vi.fn(async (key: string) => `https://s3.test/${key}?signed`),
  s3Configured: vi.fn(() => true),
  registerLocalUploads: vi.fn(() => {}),
}))

vi.mock('../src/config/mailer.js', () => ({
  isMailConfigured: vi.fn(() => false),
  sendMail: vi.fn(async () => {}),
}))

/**
 * The squad every coach has.
 *
 * `resolveSquad` sits under getSquad, saveSquad and the feedback roster, and
 * it never returns null — it creates a default squad rather than making each
 * caller handle "no squad yet". A bare deep mock returns `undefined` from
 * `findFirst`, so without this every one of those paths throws on `.id` and
 * the failure looks like a bug in the code under test rather than a missing
 * fixture.
 *
 * A test that cares which squad was used overrides this; most do not, because
 * a coach with one team is the overwhelming case in production too.
 */
export const TEST_SQUAD = { id: 1, userId: 1, name: 'My squad', ageGroup: null, sortOrder: 0, archivedAt: null }

beforeEach(() => {
  mockReset(dbMock)
  const squad = (dbMock as unknown as {
    squad: { findFirst: { mockResolvedValue: (v: unknown) => void } }
  }).squad
  squad.findFirst.mockResolvedValue(TEST_SQUAD)
})
