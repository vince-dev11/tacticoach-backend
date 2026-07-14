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
}))

vi.mock('../src/config/mailer.js', () => ({
  isMailConfigured: vi.fn(() => false),
  sendMail: vi.fn(async () => {}),
}))

beforeEach(() => {
  mockReset(dbMock)
})
