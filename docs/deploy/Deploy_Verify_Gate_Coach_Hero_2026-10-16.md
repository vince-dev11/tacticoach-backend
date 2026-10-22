# Deploy — email verification gate + coach page hero (16 Oct 2026)

## What changes for people

**Verify your email first (VERIFY-GATE).** Owner's decisions: everyone who logs in; accounts made before today get 7 days' grace; while unverified they can look around but not use the tools.

- **New accounts (from 16 Oct):** gated at once. They can open the dashboard, library, books, profile and the read-only pitchside board. Opening the editor, drill sheets, sessions, planner, club, feedback, writing a book or buying one shows **"Verify your email to continue"**. That screen has: their address, *I've verified — continue*, *Resend the link*, *Wrong address? Contact us*, and *Log out*.
- **Older accounts:** the amber banner says *"Please verify your email by 23 October…"*. After that date they get the same gate.
- **Any action the API refuses** (403 `email_unverified`) — from a screen that isn't route-gated, or a tab left open — opens the same screen over the page. It does not show a raw error.
- **Never gated:** the owner; anyone who joined through an emailed link (set-password, parent invite), because following the link verifies them; and verifying, resending, changing your email or password, deleting your account, and logging out.

**Coach page hero.** The name, role and badges, philosophy and bio now sit together on the left, with the photo and contact button on the right. The contact button text stays readable on any brand colour.

## API (`tacticoach-api`)

- `src/lib/email-verify-gate.ts` (new), `middleware/auth-guard.ts`, `users.service.ts` (`/users/me` → `emailVerification`), and `forgetGate` on verify / reset / admin email change.
- Env (optional):
  - `EMAIL_VERIFY_GATE_FROM=2026-10-16` is the default.
  - `EMAIL_VERIFY_GATE=off` works **only locally**; production ignores it.
- Tests: `tests/verify-gate.test.ts` (7 tests). The full suite passed earlier (1528 tests).

## Web (`tacticoach-frontend`)

- New files:
  - `components/VerifyGate.tsx` (`RequireVerified`, `VerifyGateHost`)
  - `lib/verifyGate.ts`
- Changed files:
  - `App.tsx` (gates the tool routes; host at the root)
  - `lib/api.ts` (403 `email_unverified` → `tc:verify-required`)
  - `lib/auth.ts`
  - `VerifyEmailNotice.tsx` (grace date)
  - `verify-email-notice.css`
  - `ErrorScreens.tsx` (`NoticeShell` exported)
- Copy: `auth.verifyGate*` and `auth.verifyGrace` in all 7 locales, plus en-US.
- Coach hero: `pages/CoachPage.tsx`, `pages/club-page.css`.
- Tests: `tests/unit/verifyGate.test.tsx` (7). The batch with locales, hardcoded copy, themed controls, api, routes, family and coach page passed: 13 files, 544 tests. Typecheck (`tsc -b`) and eslint are clean.

## Local Playwright (live suite)

No setting needed (changed 17 Oct, after the first run failed 59/59 on the verify screen). Off production, an address on the reserved `.test` domain — every account the suite registers — is never gated. In production that exemption does not exist. Just **restart the local API** after pulling so it has this code. (`EMAIL_VERIFY_GATE=off` still exists for turning the gate off locally altogether.)

## Deploy order

1. **API first** (the web gate reads `emailVerification`, and an older web build simply ignores it):
   ```
   cd tacticoach-api && git add -A && git commit -m "VERIFY-GATE: verify email before using the tools (7-day grace for existing accounts)" && git push
   ssh ubuntu@13.53.60.120
   cd /var/www/html/tacticoach-backend && git pull && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh
   ```
2. **Web:**
   ```
   cd tacticoach-frontend && git add -A && git commit -m "VERIFY-GATE screen + grace banner; coach page hero; stale-build reload; pause fix; coach fields" && git push
   # on the server
   cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
   ```

## Check after deploy

- In a private window, sign up with a new address, open **Editor**, and check you see the verify screen. Click **Resend**, open the link, return, click **I've verified — continue**, and check the editor opens.
- With an older unverified account (Admin → Users, filter unverified), check the dashboard banner shows 23 October.
- Check the coach page `tacticoach.co.uk/coach/vince-admin`: the hero layout, and the button text is readable.

## Watch

Email delivery is now on the critical path. If verification mail fails, new coaches are stuck. Check Admin → Users (email problem filter) and the pm2 `[emails]` lines on the first day. The SMTP diagnosis from earlier is still open.

## Added: coach page boards play like the library (SHARE-LIVE)

A tactic opened from a coach's page (`/share/board/:id`) now uses the library's Watch player: 2D · 3D · Stadium, camera (TV / whole pitch / walk round), Full screen. Visitors get every view (they are watching the author's work; no Pro tag or upgrade dialog there).
Files: `components/LiveBoardPlayer.tsx` (`board` + `open3d` props), `pages/ShareBoard.tsx`, `pages/share.css`. Test: `livePlayer.test.tsx` SHARE-LIVE. Check after deploy: open a tactic from `tacticoach.co.uk/coach/vince-admin`, switch to 3D and Stadium, try Full screen.

## Added: Admin "Extend trial" looked like it did nothing (ADMIN-TRIAL)

Coaches with an old `trial` subscription row that had run out: Extend trial correctly extended their free trial (`users.free_trial_ends_at`, which is what access reads), but Admin → Users read only the dead row, so it kept saying "trial · until <old date>" and "Trial ended".
- API `modules/admin/user-filters.ts`: `trialEndsAt` uses the extended free trial when it is later than a run-out trial row; the "Trial ended" filter leaves those people out. Test: `admin-crm-filters.test.ts` ADMIN-TRIAL.
- Web `pages/Admin.tsx`: the Plan column shows "free trial · until …" when the subscription row is no longer live and a trial is running. Test: `adminTrialExtend.test.ts`.

## Pause between frames (PAUSE-FIX) — check it is live

The fix is in frontend commit `aa8d75e`; the last web deploy I know of was `21a541b`. On the server: `cd /var/www/html/tacticoach-frontend && git log -1 --oneline`. If it is older than `aa8d75e`, the coach is still on the old animation — deploy the web.

## Added 17 Oct: still "a slight delay between frames" (PAUSE-2)

PAUSE-FIX is live (checked in the production files). Measured on board 30 (rondo, round players) in the live editor: no dropped screen frames, frame changes exactly 3.00 s apart — so not a browser stall. The ball itself caused it: each pass left at ~210 px/s and crawled into the receiver at ~25 px/s (an eighth of its speed), then was struck again at full pace — a near-stop at every corner.
- Fix (`src/editor/motionPlan.ts` `passProfile`, round players only): a pass to a team-mate fills its frame and arrives still rolling at 70% of its average pace (1.3× → 0.7×). Real players unchanged (the receiver plays a touch). Same plan drives 2D, 3D/Stadium, videos and books.
- Tests: `pauseFix.test.ts` PAUSE-2 (3 new). All 24 motion/video/book test files pass (654 tests); typecheck and eslint clean.
- Check after deploy: board 30 → Movement → Play: the ball should flow round the square without slowing to a crawl at each player.
