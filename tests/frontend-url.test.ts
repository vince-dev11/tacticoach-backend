// FRONTEND_URL is the base for every absolute URL inside an email.
//
// The set-password button, the reset link, the club invite, the guardian view
// and the logo in the header all build on it. Unset, it defaulted to
// http://localhost:5280 — so production mailed real coaches a link they could
// not open and a logo that rendered as a broken image. Nothing threw, nothing
// logged; the only way to find out was for somebody to open the email.
//
// The guard lives at boot rather than at send time, because boot is loud.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_SRC = readFileSync(resolve(process.cwd(), 'src/config/env.ts'), 'utf8')
const EMAILS_SRC = readFileSync(resolve(process.cwd(), 'src/lib/emails.ts'), 'utf8')

describe('FRONTEND_URL', () => {
  it('refuses to boot a production server pointed at localhost', () => {
    expect(ENV_SRC).toMatch(/NODE_ENV === 'production'/)
    expect(ENV_SRC).toMatch(/LOCALHOST_HOSTNAMES\.has\(host\)/)
    expect(ENV_SRC).toMatch(/process\.exit\(1\)/)
  })

  it('declares LOCALHOST_HOSTNAMES before the check that uses it', () => {
    // A `const` used above its declaration is a temporal-dead-zone
    // ReferenceError at module load — the API would not start at all, which
    // is a far worse failure than the one being prevented.
    const declared = ENV_SRC.indexOf('const LOCALHOST_HOSTNAMES')
    const used = ENV_SRC.indexOf('LOCALHOST_HOSTNAMES.has(host)')
    expect(declared).toBeGreaterThan(-1)
    expect(used).toBeGreaterThan(declared)
  })

  it('still allows localhost in development', () => {
    // The default exists so a developer can clone and run without config.
    expect(ENV_SRC).toMatch(/FRONTEND_URL: z\.string\(\)\.default\('http:\/\/localhost:5280'\)/)
  })

  it('is what emails build their links and their logo from', () => {
    // If someone hardcodes a URL in emails.ts, the boot guard stops protecting
    // that link — so the coupling is asserted rather than assumed.
    expect(EMAILS_SRC).toMatch(/const site = env\.FRONTEND_URL/)
    expect(EMAILS_SRC).toMatch(/\$\{site\}\/email\/logo\.png/)
  })

  it('has no absolute http(s) URL hardcoded in emails', () => {
    const hardcoded = EMAILS_SRC.split('\n')
      .map((line, i) => [i + 1, line.split('//')[0]] as const)
      .filter(([, code]) => /https?:\/\/(?!\$\{)/.test(code))
      .map(([n, code]) => `${n}: ${code.trim()}`)

    expect(hardcoded, hardcoded.join('\n')).toEqual([])
  })
})
