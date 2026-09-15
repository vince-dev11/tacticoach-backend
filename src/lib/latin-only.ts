// Names and titles are Latin-script, whatever language the app is in.
//
// The client blocks other scripts at the keyboard (frontend lib/latinOnly.ts);
// this is the same rule on the server, so the API refuses what the UI would
// never send. Keep the two character classes identical.
//
// "Latin" is generous on purpose — é ñ ü ç ş ł are all fine. What is refused
// is a different script (Arabic, Cyrillic, Greek, CJK, Hebrew) and emoji.

import { z } from 'zod'

const ALLOWED = /[\p{Script=Latin}\p{Mn}\p{Nd}\s.,:;!?'"’“”‘`()\[\]{}\-–—_/\\&+#@%*=<>^~|×°′″·…€£$]/u
const DISALLOWED_ONE = new RegExp(`(?!${ALLOWED.source})[\\s\\S]`, 'u')

export function isLatinText(text: string): boolean {
  return !DISALLOWED_ONE.test(text)
}

export const LATIN_ONLY_MESSAGE = 'Latin letters only'

/** Attach to any Zod string that names something: `latinOnly(z.string().max(100))`. */
export function latinOnly<T extends z.ZodString>(schema: T) {
  return schema.refine(isLatinText, { message: LATIN_ONLY_MESSAGE })
}
