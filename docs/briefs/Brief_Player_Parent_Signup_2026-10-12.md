# Brief — players and parents sign up themselves (12 Oct 2026, level 3)

**Coach problem.** "Half my players' families find TactiCoach before I've got round to adding them. They should be able to sign up, and I connect them."

**Owner's decisions (12 Oct 2026).** These reverse "players don't sign up" from earlier the same day:

- The sign-up page offers **Player** and **Parent or guardian**, alongside Coach and Club.
- A player enters their **date of birth** and ticks *"I confirm my date of birth is correct"*.
  - **Under 13:** they can't create an account. The page tells them to ask a parent to sign up as Parent or guardian. Nothing about the child is saved.
  - **13–17:** they sign up and enter a parent's name and email. The parent gets the same "say yes" email as when a coach creates the account. The account works only after the parent says yes, so there is no login straight after sign-up.
  - **18+:** an ordinary player account.
- A **parent** signs up and lands on Family, where they can **add a child**:
  - name and date of birth, under 18 only;
  - the parent's own sign-up is the consent;
  - the child has no login, and from 13 the parent can give them one.
- Coaches keep **Create account** from the squad. The age rules are the same either way.

**Who it serves.**

- Grassroots and academy coaches of junior teams: fewer accounts to create themselves.
- Players and parents who arrive on their own.

**Coach moments.**

- **Before the season:** families sign up; the coach links each player.
- **During:** feedback flows to the player, or to the parent for under-13s.

**Today in TactiCoach.**

- `/api/auth/register` refuses `player`.
- Coach-created players and the parent invite are in `modules/family`.
- The coach's "Link an existing account" finds a **player** by email.

**The gap this opens.** A child added by a parent has no email of their own, so the coach can't find them by email.

- **Fix:** the coach may type the **parent's** email.
- The parent sees "Coach X wants to connect" on Family and picks which child, or says no.
- This needs one column, `squad_players.request_parent_id` (migration 53).

**Global check.** The age of digital consent is 13 in the UK and US but varies across the EU (13–16). It stays one constant, `OWN_LOGIN_AGE`, until the owner decides on per-country values (already flagged).

**Must never.**

- An under-13 account created without a parent.
- A child's details stored before a parent acts.
- A 13–17 account that works before the parent's yes.
- A price shown to a minor.
- The coach seeing a child's date of birth: they see the age only.

**Scope now.** Everything above.

**Later.**

- Per-country consent age.
- Parents able to see every coach request before the child exists.

**Acceptance.**

1. A player under 13 gets no account. The API refuses it too (403 `under_13`).
2. A 13–17 sign-up stores the date of birth, emails the parent, and can't log in until the parent says yes.
3. Sign-up refuses without the age tick or a date of birth (422).
4. A parent signs up, adds an under-13 on Family, and that child appears with no login.
5. A coach types the parent's email. The parent accepts for the right child, and the squad row shows Connected.
6. All copy is in 7 locales and themed. Area tests and the live spec are updated.

---

## Done: coach acceptance review

**Would I use it on Tuesday night?** Yes.

- Families who find TactiCoach first no longer wait for me. A 15-year-old signs up, their parent clicks yes, and I link them by email as before.
- For my U10s, the parent signs up, adds the child, and I type the parent's email on the squad row. The parent picks the child and I'm connected.
- I never handle a date of birth: I see the age only.

| Check | Result |
|---|---|
| Coach workflow | PASS. "Link an existing account" now says "Under 13? Use their parent's email." |
| Ease of use | PASS. The date of birth decides the form; under 13 gets a clear stop and a one-click switch to a parent sign-up. |
| Children's safety | PASS. Under 13 never gets an account from sign-up, and the API refuses it (403 `under_13`). A 13–17 gets no session until the parent's yes. The age tick is required by both page and API. |
| Solves the stated problem | **YES** |

**Critical:** none.

**Important (fixed during the build):**
- A parent-added child has no email, so a coach couldn't link them. Fixed with "ask through the parent's email" and the parent choosing the child.

**Optional (later):**
- The coach isn't told when a parent says "Not my child"; the row just goes back to "no account".
- Per-country consent age (already flagged).

**Verdict: Ship.**

## Deploy (adds to `Books_And_Family_Accounts_Done_2026-10-12.md`)

- **API:** `npx prisma migrate deploy` applies **52_family_accounts and 53_family_signup**. Then run `npx prisma generate`, `npm run build` and `pm2 restart tacticoach-api`.
- **Web:** `./scripts/deploy-web.sh`.
- **Sign-up is still early access:** players and parents can only use `/signup` from an invitation link until `VITE_SIGNUP_OPEN=true`.

## Tests

- **API:** full suite, 83 files, 1,509 tests, green. New tests are in `auth.test.ts` (FAMILY-SIGNUP ×4) and `family.test.ts` (sign-up ages, parent adds a child, coach asks through the parent, migration 53). `account-type.test.ts` now accepts `parent`.
- **Frontend:** full unit suite, 177 files, 2,491 tests, green. Typecheck and eslint are clean. New tests are in `qaRound2.test.tsx` (under 13, 13–17, adult player sign-up) and `familyAccounts.test.tsx` (add a child, coach request, self-sign-up invitation).
- **Live (you run):** `family.spec.ts` FAM-05..07. Global setup makes the run's players through sign-up again (adults), so player tests no longer need the owner account.
