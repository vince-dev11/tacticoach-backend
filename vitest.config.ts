import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // env.ts reads process.env at import time — set test vars before anything loads.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://test:test@localhost:3306/tacticoach_test',
      // Long enough to satisfy the 32-char minimum env.ts enforces, and
      // distinct from each other — the same two rules production must meet.
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-fedcba9876543210fedcba9876',
      AWS_REGION: 'eu-west-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      CORS_ORIGINS: 'http://localhost:5280',
      FRONTEND_URL: 'http://localhost:5280',
    },
    // Route tests share one mocked Prisma singleton; keep a single fork so
    // mock state never leaks across parallel workers.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
