// AI-REMOVE (27 Oct 2026): the old AI module is gone (owner: clean rebuild,
// docs/ai/AI_Editor_Design_and_Plan_2026-10-19.md). Its routes must not answer,
// and the coach context it owned lives on in lib/coachContext.
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { getApp } from './helpers.js'
import { FORMAT_PROFILES } from '../src/lib/coachContext.js'

describe('AI-REMOVE · the old AI routes are gone', () => {
  it.each(['ai-layout', 'ai-animation', 'ai-correction', 'ai-credits', 'reel-copy'])('/api/canvas/%s is 404', async (path) => {
    const app = await getApp()
    const method = path === 'ai-credits' ? 'GET' : 'POST'
    const res = await app.inject({ method, url: `/api/canvas/${path}`, payload: method === 'POST' ? {} : undefined })
    expect(res.statusCode).toBe(404)
  })

  it('the module and the eval script are gone; the coach context stays', () => {
    expect(existsSync('src/modules/ai')).toBe(false)
    expect(existsSync('evals/eval-ai.ts')).toBe(false)
    expect(FORMAT_PROFILES['8v8'].perTeam).toBe(8)
  })
})
