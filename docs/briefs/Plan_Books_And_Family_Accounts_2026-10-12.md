# Plan: Books review + coach-created players with parent accounts, 12 Oct 2026

*football-product-expert level 4 (accounts for children, consent, money shown to minors) + level 3 (books). Owner's decisions in this file are binding.*

## Owner decisions (12 Oct 2026)
- **Only coaches create player accounts.** Player self sign-up closes. Existing player accounts keep working; their coach is asked to add the date of birth (and a parent for an under-18).
- **Date of birth is required** when a coach creates a player.
- **Under 18 → a parent account is required.** The parent:
  - sees the child's feedback and gets the emails;
  - buys / approves books for the child;
  - manages the child's login (reset the password, change the email, close the account);
  - **consents before the child's account works**.
- **Login by age:** 13–17 log in themselves (after the parent's consent); **under 13 have no login**: they are seen through the parent's account. 18+ are ordinary player accounts.
- **Books for a player under 18:** never a price. A paid book shows **"Ask your parent"**, which notifies the parent. (Payment gateway work is out of scope.)

## Brief: accounts
- **Coach problem:** "I want my players to get my feedback, safely, and their parents to know what I send."
- **Who:**
  - grassroots/academy coaches;
  - parents of under-18s (a new account type: `parent`);
  - players, most of them children.
- **Today:**
  - players sign up themselves and the coach asks to link;
  - the player sets a guardian email in their own profile;
  - the guardian gets a signed link to the child's notes.
- **Must never:**
  - a child account working without a parent's consent;
  - an under-13 with a login;
  - a price or Buy button shown to an under-18;
  - a parent seeing another family's child;
  - a coach seeing a parent's other children.
- **Global:** the age of digital consent varies (13 in the UK, 13–16 across the EU, 13 in the US under COPPA). 13 is the owner's rule; it's one constant (`OWN_LOGIN_AGE`).
- **Acceptance:**
  1. Sign-up has no player option, and the API refuses `accountType: player` at register.
  2. A coach creates a player from a squad row with a date of birth. Under 18 needs a parent (name + email), and the parent gets an invitation.
  3. Until the parent accepts, the 13–17 child can't log in. Under 13 never logs in. 18+ gets a set-password email.
  4. The parent's Family page lists their children, each child's feedback and book requests, and the login controls. Nothing else is reachable (deny-by-default lockdown, like players).
  5. A player under 18 (or with no date of birth yet) sees no prices; a paid book shows "Ask your parent".
  6. Existing linked players with no date of birth are flagged on the coach's squad: "Add date of birth".

## Brief: books (the review items)
1. Autosave + a leave warning in the book editor.
2. Reader:
   - "Save to my boards" / "Add to a session" on board, animation and drill blocks;
   - print a drill card or a chapter;
   - search inside a book;
   - book page "What's inside" counts, "What you'll learn", and author details;
   - age bands including U5–U8;
   - copy fixes ("1 chapters", Picture block, My books intro).
3. Author:
   - insert a board from my library and a drill sheet as a drill card;
   - writing first, with tabs for Write / Details / Cover / Sell;
   - chapter saves keep chapter ids (readers' notes and places survive);
   - chapter templates and a starting outline;
   - preview as a buyer;
   - My library shows reading progress;
   - "Recommend to my players" (a coach sends a book to linked players; the parent is told).

## Build order
1. Book autosave (no lost work).
2. Accounts: migration, API, UI.
3. Book reader items.
4. Book author items.
5. Tests, live specs, coach review, deploy note.
