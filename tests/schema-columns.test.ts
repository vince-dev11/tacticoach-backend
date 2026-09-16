// Every column in this schema is snake_case; every camelCase field therefore
// needs an @map. This is not style policing.
//
// `PlayerNote.workOns` shipped without one. Migration 20 created `work_ons`,
// the schema asked MySQL for `workOns`, and the mismatch is invisible
// everywhere it matters: `prisma generate` succeeds, `tsc` succeeds, and the
// deep-mocked unit tests succeed because a mock never touches a database. It
// surfaced as a 500 on the player's screen, in production, days later.
//
// A schema file is the one place where a typo silently becomes a runtime
// error, so it gets read as text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCHEMA = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
)

/** Prisma's scalar types. Anything else is a relation and has no column. */
const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes',
])

interface Field {
  model: string
  name: string
  line: string
  mapped: string | null
}

function scalarFields(): Field[] {
  const out: Field[] = []
  for (const model of SCHEMA.matchAll(/model\s+(\w+)\s*\{(.*?)\n\}/gs)) {
    const [, modelName, body] = model
    for (const raw of body.split('\n')) {
      // Strip both comment styles before parsing — a doc comment mentioning a
      // type name would otherwise read as a field.
      const line = raw.split('///')[0].split('//')[0].trim()
      if (!line || line.startsWith('@@')) continue

      const [name, type] = line.split(/\s+/)
      if (!name || !type) continue
      // Lists are relations; enums are not in SCALARS and map fine either way.
      if (type.endsWith('[]') || !SCALARS.has(type.replace(/[?[\]]/g, ''))) continue

      out.push({
        model: modelName,
        name,
        line,
        mapped: /@map\("([^"]+)"\)/.exec(line)?.[1] ?? null,
      })
    }
  }
  return out
}

describe('schema column names', () => {
  const fields = scalarFields()

  it('finds the fields at all', () => {
    // Guards the parser itself: if a Prisma syntax change breaks the regex,
    // every assertion below would pass vacuously and prove nothing.
    expect(fields.length).toBeGreaterThan(100)
    expect(fields.some((f) => f.model === 'PlayerNote' && f.name === 'workOns')).toBe(true)
  })

  it('maps every camelCase field to a snake_case column', () => {
    const unmapped = fields
      .filter((f) => /[A-Z]/.test(f.name) && !f.mapped)
      .map((f) => `${f.model}.${f.name} — add @map("${snake(f.name)}")`)

    expect(unmapped, unmapped.join('\n')).toEqual([])
  })

  it('never maps to a name that is not snake_case', () => {
    // Catches the opposite slip: @map("workOns"), which would compile and then
    // ask for a column no migration creates.
    const wrong = fields
      .filter((f) => f.mapped && !/^[a-z][a-z0-9_]*$/.test(f.mapped))
      .map((f) => `${f.model}.${f.name} — @map("${f.mapped}")`)

    expect(wrong, wrong.join('\n')).toEqual([])
  })

  it('maps workOns to the column migration 20 actually created', () => {
    const workOns = fields.find((f) => f.model === 'PlayerNote' && f.name === 'workOns')
    expect(workOns?.mapped).toBe('work_ons')
  })
})

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
