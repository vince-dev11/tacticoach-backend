// Booleans from environment variables.
//
// `SMTP_SECURE=false` used to parse as TRUE: the schema used
// `z.coerce.boolean()`, which is `Boolean(value)`, and every non-empty string
// is truthy. nodemailer would then open a TLS socket to port 587 — which
// expects plaintext followed by STARTTLS — and the first email would hang
// until it timed out, with nothing in the config looking wrong.
//
// The asymmetry is why this is worth a test: `secure: false` against a TLS-only
// port (465) fails loudly at connect and is obvious; `secure: true` against a
// STARTTLS port (587) hangs and is not. So anything that is not explicitly a
// yes-word resolves false.

import { describe, it, expect } from 'vitest'
import { envBool } from '../src/config/env.js'

const parse = (value: string | undefined, fallback = false) =>
  envBool(fallback).parse(value) as boolean

describe('envBool', () => {
  it('is false for the literal string "false"', () => {
    // The whole bug, in one assertion.
    expect(parse('false')).toBe(false)
  })

  it.each(['true', 'TRUE', '1', 'yes', 'on', ' true '])('is true for %s', (v) => {
    expect(parse(v)).toBe(true)
  })

  it.each(['false', '0', 'no', 'off', 'nope', 'ture'])('is false for %s', (v) => {
    // A typo must fail SAFE — see the note above about which way hangs.
    expect(parse(v)).toBe(false)
  })

  it('uses the fallback when unset', () => {
    expect(parse(undefined)).toBe(false)
    expect(parse(undefined, true)).toBe(true)
  })

  it('uses the fallback for an empty string, not false', () => {
    // `SMTP_SECURE=` with nothing after it means "not set", not "off".
    expect(parse('', true)).toBe(true)
  })

  it('never returns a non-boolean', () => {
    // z.coerce.boolean() would happily hand back whatever Boolean() produced;
    // every caller here treats the result as a real boolean.
    for (const v of ['true', 'false', '', undefined, 'garbage']) {
      expect(typeof parse(v)).toBe('boolean')
    }
  })
})
