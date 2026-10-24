// SENTRY-PROD (24 Oct 2026) · the API reports to Sentry only when NODE_ENV=production.
import { describe, it, expect } from 'vitest'
import { shouldInitSentry } from '../src/instrument.js'

const DSN = 'https://abc@o1.ingest.sentry.io/1'

describe('SENTRY-PROD · API', () => {
  it('no DSN: never', () => {
    expect(shouldInitSentry({ NODE_ENV: 'production' })).toBe(false)
  })
  it('a local API with the DSN set (NODE_ENV development or unset): no', () => {
    expect(shouldInitSentry({ SENTRY_DSN: DSN, NODE_ENV: 'development' })).toBe(false)
    expect(shouldInitSentry({ SENTRY_DSN: DSN })).toBe(false)
  })
  it('production: yes', () => {
    expect(shouldInitSentry({ SENTRY_DSN: DSN, NODE_ENV: 'production' })).toBe(true)
  })
  it('tests: never; SENTRY_FORCE=1 tests the wiring from a dev process', () => {
    expect(shouldInitSentry({ SENTRY_DSN: DSN, NODE_ENV: 'test', SENTRY_FORCE: '1' })).toBe(false)
    expect(shouldInitSentry({ SENTRY_DSN: DSN, NODE_ENV: 'development', SENTRY_FORCE: '1' })).toBe(true)
    expect(shouldInitSentry({ SENTRY_DSN: DSN, NODE_ENV: 'development', SENTRY_FORCE: 'true' })).toBe(true)
  })
})
