// The Latin-only rule, server side. Mirrors the client's lib/latinOnly.ts —
// the two character classes must stay identical, so the cases here are the
// same ones the frontend test runs.

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { isLatinText, latinOnly } from '../src/lib/latin-only.js'

describe('isLatinText', () => {
  it.each([
    'Rashmin Ferreira',
    'Müller',
    'Échauffement — 1ère partie',
    'Calentamiento: rondo 4v2 (12×12)',
    'Şükrü Öztürk',
    'Łukasz',
    "O'Brien & Sons #2",
    'Session 1 · 90′',
  ])('accepts %p', (s) => expect(isLatinText(s)).toBe(true))

  it.each([
    'تمرين الضغط',
    'Иван Петров',
    'トレーニング',
    'Γιώργος',
    'שלום',
    'Warm-up ⚽',
    'Session 😀',
  ])('rejects %p', (s) => expect(isLatinText(s)).toBe(false))
})

describe('latinOnly()', () => {
  const schema = z.object({ name: latinOnly(z.string().min(1).max(50)) })

  it('passes a Latin name through unchanged', () => {
    expect(schema.parse({ name: 'José' }).name).toBe('José')
  })

  it('refuses another script with a readable message', () => {
    const r = schema.safeParse({ name: 'Иван' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Latin letters only')
  })
})
