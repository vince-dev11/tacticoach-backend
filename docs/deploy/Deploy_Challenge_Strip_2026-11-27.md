# Deploy note: weekly challenge moved up the dashboard (27 Nov 2026)

Web app only. No API change, no migration.

## What ships (CHALLENGE-STRIP, owner chose the slim line from three designs)

- **Dashboard:** this week's challenge is one line straight under the greeting: its title, the time left and "Enter the challenge". It was a card at the very bottom, which coaches did not scroll to.
  - ✕ hides it until the next challenge (remembered on that device).
  - A coach who has entered sees "You're in · See the entries".
  - Coaches and clubs only. Players no longer see a challenge on their dashboard (they could not enter one).
- **Bottom of the dashboard:** the challenge card is gone; the featured coach card stays, under the heading "From the community" (it was a second "This week", the same name as the block near the top).

## Tests

`tests/unit/challengeStrip.test.tsx` (4) plus the dashboard, wording and copy tests: pass. Typecheck and eslint clean. Seen in the browser on the local site with a stand-in challenge (the local database has none running).

## After deploy

With a challenge running, open the dashboard as a coach: the line is under the greeting. Press ✕, reload: it stays hidden.
