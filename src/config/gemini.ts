// Gemini client — minimal fetch wrapper around the Generative Language API.
// Optional like Stripe/SMTP: the API boots without a key and the AI routes
// return 503 until GEMINI_API_KEY is set.

import { env } from './env.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const REQUEST_TIMEOUT_MS = 45_000

export function geminiConfigured(): boolean {
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
export async function generateTacticsJson(
  system: string,
  user: string,
  options: GenerateOptions = {},
): Promise<unknown> {
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
