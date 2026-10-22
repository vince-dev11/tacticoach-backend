# AI for coaches and players: research and recommendations (19 Oct 2026)

**Question (owner).** What would make AI really useful to football coaches and players, and how do we fix the real problems they have with AI today?

**How this was done.**
- Web research on coach pain points, the AI coaching tools on the market in 2026, the evidence on AI quality in football, and the rules on children and AI.
- A read of what TactiCoach's AI already does: the API's `src/modules/ai` and the *AI Football Brain PRD v1.1*.
- The football-product-expert lens throughout (this is a level-4, core capability).

**Honesty note on the evidence.** Most material about "AI coaching apps" is written by the vendors themselves. I found no independent study of how good AI-generated football sessions are. Where a claim comes only from a vendor, it is marked **(vendor)**.

---

## 1. The short answer

Coaches don't lack ideas: the internet is full of drills. What they lack is:

- **time**;
- **a plan that fits tonight**: these players, this space, this kit, this age and format;
- **a picture** they and their players understand;
- **a way to keep track of players** and give them feedback.

Generic AI (ChatGPT, and most "AI session planner" apps) answers the first need with **text**. It doesn't know tonight's numbers, can't draw the drill, isn't checked for football sense, and forgets everything after the chat.

**TactiCoach can fix the real problem** because it already has the three things those tools lack:

1. **A football engine that can't produce impossible football.** The deterministic DSL and validators mean no teleporting, no ball nobody played, no overlapping players.
2. **An editor**, so an AI result becomes an animated board the coach can change.
3. **The coach's world**: squad, sessions, season plan, feedback to players, Match Day.

So the strategy is not "add a chatbot". It is:

> **AI proposes, the board shows it, football rules check it, the coach decides, and it stays connected to the team.**

Recommended first three: **Tonight's session re-planned in seconds** (§5 A), **say or type it, see it animated** (B), and **pitch-side voice notes that turn into player feedback** (D). All three sit on features we already have.

---

## 2. The coach's real problems (evidence)

| # | Problem | Evidence | What generic AI does today |
|---|---|---|---|
| P1 | **No time; volunteers burn out.** Admin, messages and organising crowd out coaching. | Spond's report says coaches "spend hours on admin before they even arrive at the pitch" (about 3.1 million people coach weekly in the UK, Spond 2019). Volunteers in a 2025 *Telegraph* investigation kept naming "admin overload, poor communication, uncertainty around availability". A Winchester University study (June 2025) found poor behaviour hurts volunteer retention. | Saves typing, adds checking. |
| P2 | **Tonight never matches the plan.** Numbers change, half a pitch, no goalkeeper, mixed ability. | Football DNA coaches' feedback: mixed abilities, juggling roles, a flood of messages. Spond: "Friday-night optimism turning into Sunday-morning panic". | Writes a fresh generic plan. It doesn't adapt *your* plan to *your* numbers. |
| P3 | **Text isn't a picture.** A session has to be drawn and explained to children. | A third-party review of the best-known free AI planner (Coach Frank): "sessions only; no diagrams". A 2025 study on grassroots coaching stresses simplifying football language for young players. | Text, or at best a static diagram. |
| P4 | **AI football is unchecked.** Wrong numbers, impossible movement, the wrong format for the age, one country's habits presented as universal. | Research on LLMs in football tactics is early: FootGPT (2023) reports inconsistencies and hallucinations, TacticalGPT (2023) is preliminary. The strongest result, TacticAI (Nature Communications 2024), is *not* a chatbot: it is a specialised model checked by Liverpool's experts. I found no published error rates for AI session planners. | Confident prose with no checks. |
| P5 | **Player feedback is the first thing dropped.** Notes get lost; writing them up takes an evening. | Coachlog (vendor) built a business on voice notes. Its coaches report "no more notes getting lost in notebooks" and "I don't have to spend an hour after training hunched over a notebook". Coachlog claims 400+ coaches signed up since November 2025. | Nothing ties a note to a player. |
| P6 | **No memory across the season.** Each session is a one-off, and nobody tracks what was covered. | Every competitor's pitch (CoachAI, TouchTight, Coachlog) is about "connecting the week". | A chat forgets. |
| P7 | **Players don't know what to work on, or what their role is.** | Instant, specific feedback supports young players' motivation: an AR-feedback study with 12–15-year-olds (2025), and a study of coach feedback in youth football. There is **no** direct evidence yet for AI home-practice apps for adolescents. | An open chatbot, which is risky for children (§6). |

**The real problem with AI for coaches:**
- It is **not grounded**: it doesn't know the team, tonight, the format or the country.
- It is **not checked**: nothing makes sure the football works.
- It is **not actionable**: the output is text, not a board or a session.
- It is **not connected**: nothing carries over to the season, the feedback or the players.

Each of our recommendations fixes at least two of these.

---

## 3. What's on the market (Oct 2026)

| Tool | What it does with AI | Limits (for our purpose) |
|---|---|---|
| **Coach Frank** | Free AI session plans "in less than 60 seconds", from age and topic. | Text sessions only: no diagrams, no team, no memory (third-party review). |
| **CoachAI (UK)** | Session generator, player profiles, matchday line-ups, an "assistant manager" that knows the squad. £0 / £5.99 / £8.99 a month. | Its comparison page is its own marketing **(vendor)**. Text-first; no animated tactics. |
| **TouchTight** | "The Gaffer" **selects a real session from a human library; it does not write one**. 2,000+ coaching videos (vendor). | A deliberate choice of trust over generation. Its site bans using its content to train AI. |
| **Coachlog** | Voice notes → transcribed → linked to players → stats and reports; "AI Assistant: ask questions about your team". EU data hosting, zero-retention model calls (vendor). | Observations only: no planning, no board. |
| **FootballGPT, Hobbit AI, Touchline Studio, Saideline** | Chat-style session ideas, some with simple diagrams. Touchline Studio asks about intent and practicalities first. | Generic; checked by no one. |
| **Veo (cameras)** | Auto-recorded matches, AI clips, a highlight reel for each player. | Hardware and price; aimed at clubs and academies. |
| **TacticalPad** | The established tactics board. | No conversational AI (per a competitor's comparison). |

**The gap nobody fills:** an AI that turns *this coach's* intent and *tonight's* constraints into a **checked, animated, editable** practice. It should be connected to the session, the season and each player's feedback, and work for every country's formats.

**Two lessons from competitors:**
- TouchTight chose to retrieve sessions instead of generating them, *because of trust*. Our version: generate, but only through the football engine, and **show what was assumed**.
- Coachlog shows coaches will pay to stop losing their observations. Voice beats typing on the touchline.

---

## 4. What TactiCoach's AI is today (from the code and the PRD)

- `POST /ai-layout` and `/ai-animation`: from a coach's sentence to board objects and frames.
  - A **deterministic DSL** (`ai.dsl.ts`): the model picks a pattern and its parameters; the compiler owns all positions.
  - **10 football validators**, one retry that corrects the model's errors, and an **eval suite** (36 cases, 80% gate).
- **Coach context** (`ai.context.ts`): age, format (the coach's own, never inferred from age), level.
- 14 validated exemplars. AI credits (`/ai-credits`), a corrections log (`/ai-correction`) and an owner summary.
- Social reel copy (`/reel-copy`).
- The frontend is behind `VITE_ENABLE_AI`.

This is a **stronger base than the competitors'** for P3 and P4. What's missing is mostly P1, P2, P5, P6 and P7.

### ⚠ Found during this research: fix before any AI launch (Critical)

- **The AI puts the team on the wrong flanks.** `ai.dsl.ts` has the home team attacking left to right but places **RB, RW and RM at the top** (y = 130), and LB, LW and LM at the bottom.
  - Facing right, a team's right side is the **bottom** of the screen. That is what the editor's formations do, and what the new shirt-numbers tests check.
  - So an AI board shows the 2 and the 7 on the left flank: the exact complaint coaches have been sending.
  - The AI also numbers players England's way only (RCB 4, LCB 5), not with the coach's new numbering style.
- **Fix:** mirror the DSL's lanes so "right" means the bottom when attacking right. Number through the frontend's `numbersFor`, or the same tables on the API. Add an eval case that checks every flank.

---

## 5. Recommendations: what to build, for whom, in what order

Each item says which problems it solves, the coach moment, and what must never happen.

### NOW: on what exists (highest value, lowest risk)

**A. "Tonight's numbers": re-plan the session in seconds** (P1, P2)
- *Coach moment:* 10 minutes before training. "14 turned up not 18, one keeper, half the pitch, 50 minutes."
- *How:*
  - Extend `refit.ts` / `TonightsNumbers` (a deterministic refit made as a copy) so each practice and step is re-sized. Areas are kept in proportion to m² per player.
  - The AI only proposes which practice to cut or shorten, and gives the reason in a line.
  - It works offline-first with the pitch-side copy.
- *Never:* change the saved plan without a copy, or drop the game at the end without saying so.
- *Why first:* no competitor adapts *your* plan to *tonight*. This is the moment coaches feel the most pain.

**B. Say it or type it, see it animated: harden what we have** (P3, P4)
- Before generating, **ask 1–3 questions only when the answer changes the result** (the skill's rule: infer when the request names the practice, ask when age, numbers or format are unknown).
- After generating, show an **"assumed" strip**: "Assumed 7v7, U11, half pitch, 12 players". One tap fixes any of it.
- Fix the flank bug. Number by the coach's style. Use the new **timing** (after the pass) and **pass type** (lofted, into space) in the DSL, so AI boards play like hand-made ones.
- Grow the exemplars from boards coaches *kept* (the PRD's learning loop). Every change must pass the evals.
- *Never:* show unvalidated output, or present one country's format as universal.

**C. A session from an objective** (P1, P6)
- "Playing through midfield, U12, 9v9, 75 minutes" → warm-up, practice, progression (**Steps**), a game, and 2–3 coaching points. **Every practice is a real, animated board.**
- Draw from the coach's own boards first, then the club's library and the books, and generate only what's missing.
- *Never:* coaching points that just describe the drill; numbers that don't add up; a session with no game.

**D. Pitch-side voice notes → player feedback, approved by the coach** (P5)
- *How:*
  - Hold to talk on the touchline: "Ana, great scanning before receiving; Ben lost his runner twice."
  - Transcribed and matched to squad names, it becomes **a draft** in the existing coach→player feedback.
  - The coach edits, approves and sends.
- *Never:*
  - A message goes to a child unapproved.
  - The audio is kept after transcription (or only for a short, stated time).
  - Children's data is used to train a model.
- *Evidence of demand:* Coachlog **(vendor)**, and the "lost notebooks" problem every coach recognises.

### NEXT: connect the week and the season

**E. Season memory and gaps** (P6)
- In the season planner: "Defending transitions not coached for 5 weeks. Three players had 'first touch' feedback twice. Suggest next session?"
- Purely from our own data, with no guessing about children's ability.

**F. Match Day assistant** (P1)
- Half-time: two or three points from the coach's notes. After the match: a short report for parents that the coach approves (no child names unless the coach ticks it, as with boards).
- No AI is needed for fair playing time: Match Day already tracks each player's minutes against a fair share and suggests who comes on next.

**G. Photo or sketch → board** (P3; PRD phase 4)
- A photo of a whiteboard or a paper diagram becomes an editable board. It suits coaches who still plan on paper.

**H. "Explain this board" for players and parents** (P7)
- The coach can generate a child-friendly caption and 2–3 stop-and-think questions for a board (the **Teach** layer already exists), then edit them.
- The share link and books use them.

### LATER: players and clubs (with extra care)

**I. Player homework from the coach's feedback** (P7)
- A player sees 2–3 practices the **coach chose or approved** for them, each with an animated board and a "done" tick. The coach sees who did it.
- For under-18s: **no open chatbot**, no AI talking to the child directly, and no ratings or rankings (§6).

**J. Adult players (18+): ask about my role**
- Answers only from the coach's boards and notes for that team ("What does the coach want from the 6 when we lose the ball?"), with the board it came from.

**K. Club methodology**
- A club uploads its curriculum. Sessions and AI suggestions follow it. The director of coaching sees coverage across teams.

### Not recommended (now)

- **AI rating, ranking or talent-ID of children.** It is profiling of minors, harmful to motivation, and a legal risk (§6).
- **An open AI chat for players under 18.** The EU's proposed KIDS Act names AI chatbots that minors can use as in scope (§6).
- **Our own match-video AI.** Partner with or import from Veo or Hudl later. Building it is a different company.
- **"AI predicts the result" or tactics claims beyond what the engine can check.**

---

## 6. Guardrails: trust, children, money

| Area | Rule for TactiCoach AI |
|---|---|
| **Football correctness** | Generation always goes through the deterministic engine and validators. The eval suite must pass on every change, and it gains cases for format, numbers and flanks. Show assumptions; never present a country's convention as a law. |
| **Coach control** | Every AI result is a draft: a board, session or message the coach edits. Nothing is published or sent without the coach. "Regenerate" and "Undo" are always there. |
| **Children (UK and EU)** | **UK:** the ICO's Children's Code is a set of 15 standards, including default settings, profiling and nudges. Its consultation draft said profiling should be off by default; check the final wording before relying on it. **EU:** the Commission's **KIDS Act proposal** (17 Sep 2026) covers AI chatbots minors can access and would require profiling-based recommendations for minors to be off by default. Self-declared age is not enough. It is a *proposal*, not law yet. **For us:** players under 18 get no AI chat, no profiling, no ratings; AI is used *by the coach about the session*, not *on the child*. This fits our existing family-account rules. |
| **Data** | Minimise: send the model roles and numbers, not names, wherever possible. Pick a provider with zero retention or no training. Prefer EU or UK processing. Delete voice audio after transcription. Write it into the privacy policy before launch. *(Not legal advice: have this reviewed.)* |
| **Cost** | AI credits per plan (the route exists). Deterministic features (A's refit, E's season gaps) cost no model calls; reserve model calls for B, C, D and G. |
| **Global** | The model answers in the coach's language (7 locales). Format, numbering and units come from the coach's settings and are never inferred from age. |

---

## 7. Phased plan and how we'll know it works

| Phase | Ship | Success measure |
|---|---|---|
| **0 · Before launch** | Fix the AI flank bug; number by the coach's style; add flank and number eval cases; write the privacy wording. | Eval ≥ 80% with the new cases; no flank errors. |
| **1 · Now (≈6–8 weeks)** | A Tonight's numbers · B Hardened text → board, with "assumed" and up to 3 questions · D Voice notes → feedback drafts. | Time from opening to a runnable session < 2 min. ≥ 60% of AI boards kept without regenerating. ≥ 50% of voice notes become sent feedback. |
| **2 · Next** | C Session from an objective · E Season memory · F Match Day assistant · H Explain this board. | Sessions per coach per week up; 4-week coach retention up versus non-AI coaches. |
| **3 · Later** | G Photo → board · I Player homework · J Adult-player Q&A · K Club methodology. | Player completion of homework; club renewals. |

**Learning loop (from the PRD):** every board a coach keeps without regenerating feeds the exemplar library. At a few hundred, it becomes the data for retrieval, and later fine-tuning. **Never use children's data for this; boards only.**

---

## 8. Decisions for the owner

1. **Which first three?** My recommendation is **A, B, D** (each fixes the "real problem" and builds on what exists).
2. **AI credits per plan:** how many for Basic and Pro, and whether A and E (no model calls) are unlimited.
3. **Players under 18:** confirm the rule of no AI contact with children, and AI only through the coach.
4. **Model provider and data region:** the PRD names Gemini Flash. Confirm zero retention and EU/UK processing before voice notes (D).
5. **Fix the flank bug now** (§4), whatever else is decided.

---

## Sources

- Spond, *Grassroots Coaching in Crisis?* (2019 report): https://www.spond.com/app/uploads/2023/04/Spond-grassrootscoachingincrisis.pdf
- Spond, *Grassroots Sports Are Reaching Breaking Point* (Dec 2025, citing *The Telegraph*): https://www.spond.com/news-and-blog/grassroots-sport-breaking-point-spond/
- University of Winchester, grassroots behaviour study (2025): https://winchester.ac.uk/News-and-Events/Press-Centre/Media-Articles/Study-explores-the-ugly-side-of-the-beautiful-game-at-grassroots-level.php
- Football DNA, *Common challenges for grassroots coaches*: https://footballdna.co.uk/common-challenges-for-grassroots-coaches/
- Retos (2025), communication skills of grassroots coaches: https://revistaretos.org/index.php/retos/article/download/114676/82992/523780
- Coach Frank: https://coachfrank.ai/
- CoachAI, *Best AI football coaching tools UK 2026* (vendor comparison): https://www.coachai.uk/blog/best-ai-football-coaching-tools-uk-2026
- TouchTight: https://www.touchtight.com/
- Coachlog: https://www.coachlog.app/
- Hobbit, *Best soccer coaching apps*: https://hobbit.football/tools/best-soccer-coaching-apps
- Touchline Studio (App Store): https://apps.apple.com/us/app/touchline-studio/id6757970508
- Veo, AI cameras in youth academies: https://www.veo.com/article/how-ai-football-cameras-transform-youth-academy-operations
- FOCUS thesis (Universidade Nova de Lisboa, 2025), AI feedback for youth clubs: https://run.unl.pt/handle/10362/187275
- TacticAI (Nature Communications 2024; arXiv): https://arxiv.org/pdf/2310.10553
- FootGPT (arXiv 2023): https://arxiv.org/pdf/2308.08610
- TacticalGPT (StatsBomb conference 2023): https://blogarchive.statsbomb.com/uploads/2023/10/TacticalGPT-Uncovering-the-Potential-of-LLMs-for-Predicting-Tactical-Decisions-in-Professional-Football.pdf
- AR feedback and motivation in youth soccer (Frontiers in Psychology 2025): https://public-pages-files-2025.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1661936/pdf
- Coach feedback in youth football (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC11903411
- ICO, Age Appropriate Design Code: https://ico.org.uk/media/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services-2-1.pdf
- EU KIDS Act proposal, analysis (Latham & Watkins, Sep 2026): https://www.lw.com/en/insights/eu-kids-act-eu-commission-publishes-proposal-on-child-protection-online
- EU KIDS Act, analysis (Browne Jacobson): https://www.brownejacobson.com/insights/eu-kids-act-what-digital-platforms-and-ai-providers-need-to-know
- Internal: `TactiCoach_AI_Football_Brain_PRD_v1.1.docx`; `tacticoach-api/src/modules/ai/*` (read 19 Oct 2026).
