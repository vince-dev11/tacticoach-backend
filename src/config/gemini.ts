// Gemini client — minimal fetch wrapper around the Generative Language API.
// Optional like Stripe/SMTP: the API boots without a key and the AI routes
// return 503 until GEMINI_API_KEY is set.

import { env } from './env.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const REQUEST_TIMEOUT_MS = 45_000
// Reasoning models (Nemotron Super etc.) think for a long while before
// answering — give OpenAI-compat providers a much longer leash.
const OPENAI_COMPAT_TIMEOUT_MS = 150_000

export function geminiConfigured(): boolean {
  if (env.AI_PROVIDER === 'openai-compat') return Boolean(env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL)
  return Boolean(env.GEMINI_API_KEY)
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = true,
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

export interface GenerateOptions {
  /** Gemini responseSchema — constrains the model to this exact JSON shape,
   *  eliminating malformed-output retries at the source. */
  responseSchema?: unknown
  /** Lower = more deterministic. Structural output wants ~0.4. */
  temperature?: number
}

/**
 * Ask Gemini for a JSON document. `system` carries the tactical instructions,
 * `user` the coach's prompt. Returns the parsed JSON (throws GeminiError on
 * transport, refusal or parse problems — the route decides how to respond).
 */
/** Pull a JSON document out of an OpenAI-compat completion — strips reasoning
 *  (<think> blocks) and markdown fences that some models emit. */
function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new GeminiError('AI returned no JSON document')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/** OpenAI-compatible providers (NVIDIA NIM, OpenAI, Groq…). The response
 *  schema is embedded as a prompt instruction — these APIs lack Gemini's
 *  constrained decoding, so the Zod parse + validators do the enforcement. */
async function generateOpenAiCompat(
  system: string,
  user: string,
  options: GenerateOptions,
): Promise<unknown> {
  const base = (env.AI_BASE_URL ?? '').replace(/\/$/, '')
  // Nemotron-family models: ask for the answer directly, without the long
  // hidden reasoning phase (both known switches; unknown ones are ignored).
  const noThink = /nemotron/i.test(env.AI_MODEL ?? '') ? 'detailed thinking off\n/no_think\n\n' : ''
  const schemaNote = options.responseSchema
    ? `\n\nRespond with ONLY a raw JSON document (no markdown, no commentary) matching exactly this schema:\n${JSON.stringify(options.responseSchema)}`
    : ''
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
      signal: AbortSignal.timeout(OPENAI_COMPAT_TIMEOUT_MS),
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: 'system', content: noThink + system + schemaNote },
          { role: 'user', content: user },
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: 8192,
      }),
    })
  } catch (err) {
    throw new GeminiError(`AI request failed: ${(err as Error).message}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GeminiError(`AI provider responded ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new GeminiError('AI returned an empty response')
  try {
    return extractJson(text)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    throw new GeminiError('AI returned invalid JSON')
  }
}

export async function generateTacticsJson(
  system: string,
  user: string,
  options: GenerateOptions = {},
): Promise<unknown> {
  if (env.AI_PROVIDER === 'openai-compat') {
    if (!geminiConfigured()) throw new GeminiError('AI provider is not configured', false)
    return generateOpenAiCompat(system, user, options)
  }
  if (!env.GEMINI_API_KEY) throw new GeminiError('Gemini is not configured', false)

  const url = `${API_BASE}/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: 8192,
        },
      }),
    })
  } catch (err) {
    throw new GeminiError(`Gemini request failed: ${(err as Error).message}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GeminiError(`Gemini responded ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new GeminiError('Gemini returned an empty response')

  try {
    return JSON.parse(text)
  } catch {
    throw new GeminiError('Gemini returned invalid JSON')
  }
}
