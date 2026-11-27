# Deploy note: third coach review + new Stadium video (27 Nov 2026)

Web app only. No API change, no migration.

## What ships

- **Home page → Coaches using it, new design (VOICES-SPOT, owner chose "Spotlight"):** one review at a time at full size, a row of faces to pick from, arrows, and a slow automatic change (every 8 s; waits while the pointer is on it; stops once the visitor picks, uses an arrow or presses pause; never runs with "reduce motion"). Every review stays in the page text for search engines. The three facts under the first review are no longer drawn (they described that one coach).
- **Third review (VOICES-TR):** the Futbol Akademisi coaching page, shown as "futbolakademisi" and linked to its Instagram page (owner: not the coach's own name, never his personal page).
  - He wrote in Turkish after looking at TactiCoach, not after using it with players, so his card carries a **First impression** badge in every language. Keep it until he has used it.
  - Turkish site: his own words. Other six languages: a translation, marked "Translated from Turkish".
- **Home page → two-video section:** the Stadium video is the new export (0.7 MB, was 4.4 MB). Note: it is a different drill from the 2D video beside it; the owner accepted that.

## Tests

`tests/unit/coachVoices.test.tsx` (11), `drillDuo`, `i18n`, `terminology`, `noHardcodedCopy`, `landingLanguage`: pass. `npm run typecheck` and eslint clean. Checked in the browser on the local site.

## After deploy

Open the home page in English and in Turkish (`/tr`) and check the third card, the faces row and the arrows.
