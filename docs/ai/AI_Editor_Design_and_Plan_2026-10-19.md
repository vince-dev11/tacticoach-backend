# AI in the editor: design and implementation plan (19 Oct 2026)

**Scope.** The editor only. A coach types or speaks what they want, the app asks for any missing details, and the AI returns a board: players, kit, area, and movement frames the coach can edit. The old `src/modules/ai` is not reused, and it is deleted when this ships.

**Status.** v2, revised 19 Oct 2026 after an independent review (Codex) that approved the direction and asked for six changes: measurable claims instead of guarantees, a complete spec with timing rules, correct data-retention wording, a full-pipeline cost estimate, alignment with the real repo layout, and a stronger evaluation set. All six are in this version. For the owner's approval; after approval the tickets in Section 10 start, and nothing is built before that.

**Level 4** (football-product-expert: core capability).

---

## 1. The idea in one line

> The coach says what they want. The AI understands it and chooses *football* (who, what, where in football words). Our own code draws it. Football rules check it. The coach edits it.

The AI never writes coordinates. That one decision removes a whole class of errors (teleports, overlaps, a ball nobody played), and it's why this design is different from the chat-style tools on the market. It does not make the board *tactically* right: that is measured, not guaranteed (Section 7).

## 2. What the research says about accuracy

I researched how to get the most accurate result from a language model for this kind of task. Five findings shape the design:

1. **Schema-constrained output guarantees the shape, not the meaning.** Both Google and Anthropic now offer constrained decoding that makes the JSON always valid. Google's own docs say to always validate values in your application and handle schema-compliant but semantically incorrect outputs. Studies in 2026 find the same: constrained decoding removes structural failures but leaves a semantic gap. **So:** use constrained output for the shape, and our own football checks for the meaning.
2. **A model checking its own work is unreliable; an external checker is reliable.** An ICLR 2025 paper (Stechly, Valmeekam, Kambhampati) found "self-correction" often makes planning worse because the model's own verification has high false positives and negatives, and gains come from an external sound verifier. **So:** the football validator is code, not a second AI call; and "retry with the errors quoted back" is driven by that code.
3. **The smaller the model's job, the better it does it.** Research on DSL generation finds few-shot examples alone can't teach a grammar, and that retrieving relevant examples and keeping the language small helps. **So:** the AI chooses from a small football vocabulary (roles, actions, directions, areas), not from the editor's 40-field object model; and it sees 2–3 similar, validated examples each time.
4. **Vendor "90–99% reliability" figures aren't benchmarks.** The only honest accuracy number is one measured on your own test set. **So:** a test set of real coach prompts with agreed answers is built *before* the generator, and every change must pass it.
5. **In football, published systems were judged by experts, not by their own checks.** TacticAI (Nature Communications 2024) was validated with Liverpool FC's experts, on corner kicks; TacEleven (Nov 2025) had experts rate its open-play suggestions, and 52.5% of its multi-step ones were rated adoptable. Those results are specific to those tasks; they don't tell us how well *our* task will go. What they do establish is that expert rating is the only accepted measure of football quality. **So:** a coach panel rates our boards (Section 7), and our job is scoped to what a coach *described*, not to inventing tactics; we assume that's easier and will measure whether it is.

## 3. Where accuracy comes from in this design

| Stage | Who does it | What can go wrong | How we keep it right |
|---|---|---|---|
| Understanding the prompt (intent) | AI | Misreads numbers, format, topic or the move | Small schema, 2–3 retrieved examples, ask when unsure, show what was assumed |
| Choosing football (roles, actions, numbers) | AI | Legal but poor choices (wrong level, dull, wrong trigger) | Vocabulary limited to real roles and actions; checked against format and age; the coach panel rates samples |
| Positions and animation | Our code | Deterministic, so the same spec always gives the same board; the engine can still place things badly (cramped, odd angles) | Unit tests on fixtures; what the engine does is inspectable |
| Football rules (overlaps, ball always played, trigger before a press, numbers match) | Our code | Only the rules we wrote are checked; passing them does not make a board tactically right | The validator's rule list is public in the doc and grows from the panel's findings |
| Words (captions, coaching points) | AI | Wrong tone or level, mistranslation | Short, editable; the coach can regenerate; rated by the panel |

What this means in numbers (targets, measured on the test set before launch; Section 7 says how):

- Boards that fail a listed football rule: **0%** of what reaches the coach (a failing board is repaired or not shown). This measures our rule list, nothing more.
- Intent accuracy (numbers, format, topic and the move understood): **≥ 90%** overall and **≥ 85% in every language** on the test set.
- Football quality: the coach panel rates ≥ 80% of sampled boards as "I'd use this" or "small edit".
- Boards a coach keeps without regenerating: **≥ 60%** in the first month; **≥ 75%** after the example library grows.
- Time from prompt to board on screen: **≤ 8 s** (p90).

## 4. The coach's experience

**Where.** A single "Ask" button in the editor's top bar, and the same panel from an empty board ("Start with a sentence"). Works in 2D, 3D and Stadium, and in Set up or Movement.

**Flow.**

1. **The prompt.** Text or voice (hold to talk). Examples shown in the coach's language: "4v2 rondo, 12 m square, U11", "Third-man run from the 6 to the 9", "Add a defender who presses the receiver".
2. **Only the questions that matter.** The AI reads the prompt and the coach's profile (age, format, level) and the current board. If something that changes the result is missing, it asks, **at most three**, as tappable choices: *How many players? (8 · 10 · 12 · other)*, *Format? (5v5 · 7v7 · 9v9 · 11v11)*, *Space? (whole pitch · half · a marked area)*. Each has a one-tap default. Nothing is asked twice in a session, and the profile answers stay answered.
3. **The result.** The board appears as a **draft** on top of the current one: a dashed outline, an "assumed" strip ("Assumed 7v7, U11, 10 players, 30×20 m"), and three buttons: **Keep · Change · Discard**. "Change" lets the coach type a correction ("make the area smaller", "the 8 should run after the pass"), which becomes a follow-up prompt on the same draft. Where a run is longer than a player covers in the frame's 3 s, the frame card shows the editor's usual "real pace" hint (BEAT-3S): the AI never changes the frame length on its own.
4. **Keep.** The draft becomes the board (one undo step). Teach questions, timing and pass types the AI set are visible in the normal controls. Keeping a board does **not** add it to the example library: that is a separate, optional tick ("Let TactiCoach learn from this board", roles and numbers only), off by default.

**Three modes, one prompt box.**

| Mode | When | What comes back |
|---|---|---|
| **New practice** | empty board or "start again" | players, kit, area, 1–4 movement frames, step names, a caption per frame |
| **Add movement** | a board with players; prompt describes a move | new frames on the existing players. The board is sent to the AI as a list of `{ref, team, label, role}`; the AI answers with the same `ref`s, so a repeated number or role can never be matched to the wrong token |
| **Edit** | a prompt starting from a draft or "change…" | a corrected draft |

**Never:** overwrite the coach's board without "Keep"; send player names to the provider (see Section 6: the board is sent as roles and numbers, and names typed into a prompt are redacted against the squad list before sending); present one country's format as universal; show a board that failed a listed rule.

## 5. The architecture

```
Coach (text / voice)
   │
   ▼
① Understand  — AI, constrained JSON → PracticeSpec (football words only)
   │              + "questions" if something that changes the result is missing
   ▼
② Resolve     — code: coach profile + answers + defaults → complete spec; records what was assumed
   ▼
③ Lay out     — code: spec → objects (formations, areaLayout, queues) in the 1400×720 contract
   ▼
④ Animate     — code: spec.phases → frames (beats, timing after-pass/after-touch, pass types, teach)
   ▼
⑤ Validate    — code: football rules (overlaps, ball played, run length, trigger, format numbers)
   │              fail → ③/④ adjust (nudge spacing) → still failing → back to ① once with the reasons
   ▼
⑥ Words       — AI, constrained JSON: frame captions, step names, 2–3 coaching points, in the coach's language
   ▼
Draft on the board  → Keep / Change / Discard → logged for the learning loop
```

Steps ③ ④ ⑤ are pure functions, run on the API, and are unit-tested like the editor. The same `PracticeSpec` is the only thing the AI produces, so it's the only thing that needs examples and tests.

### 5.1 PracticeSpec: the language the AI speaks

Small on purpose. Every value is a word a coach uses; nothing is a coordinate. This is the complete v1 shape; the zod schema in T2 is the source of truth and this section is kept in step with it.

```ts
/** What the AI returns. Either a complete spec, or the questions it needs answered first. */
type Understanding =
  | { status: 'ready'; spec: PracticeSpec; assumed: Assumption[] }
  | { status: 'ask'; questions: Question[] }        // 1–3; the coach answers, we call again with the answers

interface Question { id: 'count'|'format'|'space'|'age'|'opponents'|'which'; text: string; options: string[]; default: string }
interface Assumption { field: string; value: string; why: 'profile'|'default'|'prompt' }

type Format = '3v3'|'4v4'|'5v5'|'7v7'|'8v8'|'9v9'|'11v11'
type AgeBand = 'u7'|'u9'|'u11'|'u13'|'u15'|'u17'|'senior'
type Level = 'grassroots'|'academy'|'semi_pro'|'professional'

interface PracticeSpec {
  kind: 'practice' | 'moveOnBoard'
  /** The coach's own answers; format is never inferred from age (FR-I9). `country` is what the
      format and the shirt numbers follow, taken from the profile, never from the language alone. */
  context: { format: Format; age: AgeBand; level: Level; country?: string }
  area: Area
  groups: Group[]
  kit?: Kit
  ball: { with: PlayerRef }
  phases: Phase[]                       // 1–4
  constraints?: Constraint[]            // enum, not free text
  teach?: Teach[]
}

interface Area {
  shape: 'pitch'|'half'|'third'|'box'
  lengthM?: number; widthM?: number     // box only; 4–105
  split?: 'none'|'halves'|'thirds'|'endZones'|'boxes4'
  goals?: 'none'|'mini'|'full'|'oneFull'
}

/** A set of players placed together. `id` is how actions refer to the whole group. */
interface Group {
  id: string                            // 'attackers', 'defenders', 'servers'
  team: 'home'|'away'|'neutral'
  count: number                         // outfield players in the group
  gk?: boolean                          // this group also has a goalkeeper (counted separately)
  shape?: '4-3-3'|'4-4-2'|'4-2-3-1'|'3-5-2'|'3-2-3'|'2-3-1'|'1-2-1'|'line'|'ring'|'diamond'|'box'
  zone?: Zone                           // where the group starts
  queueAt?: 'start'                     // players waiting in a line at the group's start cone
}

/** How counts are read against the format: `count` + (gk ? 1 : 0) per TEAM must not exceed the
    format's side; neutrals and queued players do not count towards a side. */

interface Kit { cones?: 'corners'|'perimeter'; mannequins?: number; miniGoals?: 0|1|2|4 }

type PlayerRef = `${'home'|'away'|'neutral'}:${string}`   // shirt number, 'GK', or a role token (RB, LW, DM…)
type GroupRef  = `group:${string}`                         // a Group's id
type Zone = 'ownThird'|'middleThird'|'finalThird'|'leftThird'|'centre'|'rightThird'|'ownHalf'|'oppHalf'|'wideLeft'|'wideRight'|'halfSpaceLeft'|'halfSpaceRight'|'box'|'endZoneNear'|'endZoneFar'
type Target = PlayerRef | GroupRef | 'ball' | 'goal' | 'ownGoal' | `space:${Zone}`

interface Phase { name: string; actions: Action[] }        // ≤ 6 actions

/**
 * TIMING RULES (how a phase becomes one editor frame):
 *  - A phase is one frame of 3 s (BEAT-3S). The AI never sets seconds.
 *  - Actions in a phase happen in LIST ORDER. The first `pass` in a phase is "the pass" of that frame.
 *  - A `run` with start 'afterPass' waits for that pass to leave; 'afterTouch' for it to arrive
 *    (editor Frame.timing). With no pass in the phase, start is forced to 'withFrame'.
 *  - A pass needs a receiver. `to` is always a PlayerRef; `type: 'space'` means "played in front of
 *    that player into space" (the receiver runs onto it), which is how the editor's pass type works.
 *  - At most one pass per phase. A second pass is a new phase (the engine splits it if the AI doesn't).
 *  - A run longer than a player covers in 3 s is NOT shortened or slowed by the engine: it plays as the
 *    editor plays any long run (sped up), and the frame card offers the real-pace seconds.
 */
type Action =
  | { who: PlayerRef; do: 'pass'; to: PlayerRef; type?: 'feet'|'space'|'driven'|'lofted' }
  | { who: PlayerRef; do: 'carry'; toward: Target; metres?: number }        // dribble
  | { who: PlayerRef; do: 'run'; toward: Target; start?: 'withFrame'|'afterPass'|'afterTouch';
      kind?: 'overlap'|'underlap'|'thirdMan'|'support'|'press'|'drop'|'recover'|'cover' }
  | { who: PlayerRef; do: 'shoot'; at: 'goal'|'miniGoalLeft'|'miniGoalRight' }
  | { who: GroupRef;  do: 'shift'; toward: Target; metres?: number }        // a line or block moves together
  | { who: PlayerRef|GroupRef; do: 'hold' }

type Constraint = 'twoTouch'|'oneTouch'|'offsideOn'|'forwardOnly'|'endZoneScore'|'noTackling'|'timeLimit10s'
interface Teach { phase: number; spotlight?: PlayerRef; question?: string; looksAt?: Target }
```

Rules the schema enforces (constrained decoding): enums for every category, integers for counts, `maxItems` on arrays, no free-text fields except `name`, `question` and `text`. Rules the validator enforces (code): counts fit the format as defined above; every `PlayerRef` and `GroupRef` exists; the ball's holder exists; each phase has at most one pass and moves at least one player or the ball; a `press` run has a pass or carry before it in the same or previous phase (the trigger); a phase referencing a goal has one on the board.

For `moveOnBoard`, the request also carries the board as `{ ref, team, label, role, x, y }` and the spec's `PlayerRef`s are those `ref`s. Player names are never in the request.

### 5.2 The layout engine (code)

Reuses what the editor has, so AI boards look and behave exactly like hand-made ones:

- Groups with a shape → `formations.ts` slots (with the coach's shirt-number style) or the generic `ring`, `line`, `box` helpers from `templates.ts`.
- Area → `areaLayout.buildArea` (cones, splits, end zones), checked against `practice.ts` m² per player: too tight or too big is reported in the assumed strip.
- Queues → `queues.ts`; mannequins, mini goals from the asset catalogue.
- Targets → geometric resolvers: `space:halfSpaceLeft` is the half-space of the attacking direction; `toward: 'home:9'` stops a token-and-a-half short.
- Attacking direction: home attacks left → right; **a team's right flank is the bottom of the screen** (as `formations.ts` and the shirt-number tests). This was wrong in the old module and in `templates.ts` (HOME_433 has the 2 at the top); fixed as part of this work.

### 5.3 The animation engine (code)

Phases → frames via the `Beat` model (`templates.ts framesFor`), extended with what the editor learned on 17 Oct: `timing` (after the pass / after the touch), `passes` (pass type), `teach` (spotlight, stop-and-think question), and the run kinds (`overlap` curves outside, `thirdMan` starts after the first pass, `press` arrives at the receiver as the ball does). Frame length follows the editor's own rule (BEAT-3S, `frameTiming.ts`): 3 s per moving frame, long runs sped up, and the real-pace seconds offered on the frame card. The engine keeps `run` targets within the area so a run is rarely longer than the frame allows, but it never changes the frame's seconds.

### 5.4 The validator (code)

The checks the example boards already pass in `tests/unit/templateBeats.test.ts`, made into a library that runs on the API (it needs the motion plan, so `motionPlan.ts` and its dependencies move to a shared package or are copied with a sync test): tracked in every frame; nobody on anybody at a frame's end; a pass never rolls through a player; the ball always leaves a player and arrives at one; a press has its trigger; the numbers match the format; a GK only in a shape that has one; everything inside the area or the pitch. Each failure has a code and a one-line reason (used for the retry and shown to us in the log, never to the coach as jargon). **This list is what "0% rule failures" means, no more.** The coach panel's findings add rules over time.

### 5.5 Retrieval of examples

The 11 animated examples, plus AI boards coaches have **opted in** to share (roles and numbers only, reviewed by us before they enter), are stored as `PracticeSpec`s with a short description. For each prompt, the 2–3 most similar (embedding search; keyword fallback) are put in the AI's context as "here is how this is written". The evaluation set is never in this library. We expect retrieval to be the biggest lever on intent accuracy over time; T9 measures it (with and without retrieval on the holdout set) rather than assumes it.

## 6. Model and provider

Behind one adapter (`LlmProvider` with `complete(schema, messages)` and `transcribe(audio)`), so switching is a config change and the test set decides.

| Need | Recommendation | Why | Price (official pages, 19 Oct 2026) |
|---|---|---|---|
| ① Understand and ⑥ Words | **Gemini 3.8 Flash** | Constrained JSON with enums/min/max; strong in all 7 languages; fast; cheap | $0.75 in / $3.75 out per 1M tokens until 31 Dec 2026, then $1.50 / $7.50 |
| Fallback / A-B | **Claude Haiku 5.5** or **Sonnet 5.5** | Constrained JSON (grammar); zero data retention on structured outputs; strong at the words | Haiku $0.10 / $0.50; Sonnet $2 / $10 per 1M |
| Voice | **Gemini 3.5 Transcribe** (or audio straight into Flash-Lite) | Purpose-built speech-to-text; audio to the model avoids a second vendor | Transcribe about $0.003 per minute; Flash-Lite audio input $0.30 per 1M tokens |

**Cost per board, whole pipeline.** Two model calls per board (understand ≈ 3k in / 600 out; words ≈ 2k in / 400 out), one retry on 1 in 5, and an embedding lookup:

| | Now (to 31 Dec 2026) | From Jan 2027 |
|---|---|---|
| Understand (Gemini 3.8 Flash) | $0.0045 | $0.0090 |
| Words (Gemini 3.8 Flash) | $0.0030 | $0.0060 |
| Retry allowance (20%) | $0.0015 | $0.0030 |
| Embedding | < $0.0001 | < $0.0001 |
| **Per board** | **≈ $0.009 (0.7p)** | **≈ $0.018 (1.4p)** |
| Voice, per minute (Gemini 3.5 Transcribe, audio in + text out) | ≈ $0.005 | ≈ $0.005 |

So 100 boards a coach a month is about 70p now and about £1.40 from January; prices from the official page on 19 Oct 2026 and re-checked before T7. Credits per plan are set from this.

**Data rules (precise, because "zero retention" is not automatic):**
- **What leaves the server:** the prompt and corrections (after redaction), the board as roles, shirt numbers and positions, the coach's format/age/level/country. **Never** player names, squad lists or the coach's identity. Redaction: before sending, every token in the prompt that matches a name in the coach's squad (or any capitalised word followed by a shirt number) is replaced with `player:N`.
- **Training:** Gemini paid tier does not use prompts or responses to improve products; Anthropic likewise for API traffic.
- **Retention:** Google says the Gemini Developer API logs paid-tier prompts and responses for a limited time for abuse monitoring, and that guaranteed zero retention needs Vertex AI. Anthropic's structured outputs are ZDR with stated exceptions. **Decision for the owner:** accept short abuse-monitoring logs of redacted prompts (simplest), or run through Vertex AI with a ZDR agreement (more set-up). The privacy policy must say which.
- **Voice:** audio is sent for transcription and deleted from our servers once the transcript is shown; we keep the transcript only as the prompt.
- **Learning loop:** a board enters the example library only when the coach ticks the opt-in, and after our review. Keeping a board is not consent.
- **Region:** choose EU or UK endpoints where offered.
*(Not legal advice: have the wording reviewed before launch.)*

## 7. Measuring accuracy (built before the generator)

**The test set.** 350 prompts, not 200: 50 per language × 7 languages, so each language has enough to report on its own. In each language, about 30 real prompts (from the owner, the coach panel and the leads' emails, translated and checked by a native speaker where needed) and 20 written to cover the grid of format × age × topic × mode (new practice / add movement). Each has an agreed `PracticeSpec` (the "answer") written by a coach reviewer, and a tolerance (e.g. "area 10–15 m is fine"). **Split:** 250 for development, **100 held out** (untouched until a release candidate; never used to tune prompts or examples; never in retrieval). With 50 prompts per language the per-language score has a margin of about ±10 points, so per-language gates are set lower than the overall one and the set grows each quarter.

**Five scores, run by `npm run ai:eval` (reported overall and per language):**

| Score | How | Gate to ship |
|---|---|---|
| Intent | fields of the AI's spec vs the answer (exact for enums and counts; tolerance for metres) | ≥ 90% overall, ≥ 85% each language, on the holdout |
| Rules | validator pass rate after the engine, before repair | reported; ≥ 95% first-pass, 100% after repair |
| Questions | asked only when the answer changes the result (labelled in the set) | ≥ 85% precision, ≥ 80% recall |
| Football quality | coach panel rates a 40-board sample each release: use as is / small edit / wrong practice / wrong level | ≥ 80% "as is" or "small edit"; rated blind, without seeing the AI's assumptions |
| Words | the same panel: clear · age-appropriate · right language, 1–5 | ≥ 4/5 average |

**In production:** every result logs kept / changed / discarded and the correction prompt (redacted). Weekly: the kept-rate per language, the top 10 discard reasons, and the opt-in boards reviewed for the library. The one or two coaches on the panel rate 20 random kept boards a month.

**What "accuracy" means to the coach:** the board never breaks the basic rules we check; 9 times out of 10 it's what they asked for; when it isn't, one sentence fixes it; and a real coach has rated a sample of the results, not just our tests.

## 8. Risks and how they're handled

| Risk | Handling |
|---|---|
| The AI picks a legal but dull or wrong-level practice | Retrieval of good examples; the age/level in the prompt; the coach panel's monthly rating feeds the examples |
| Voice on a windy touchline | Transcript shown before generating; one tap to fix |
| Language mix (a Portuguese coach using English football terms) | The model reads mixed input natively; the test set includes 20 mixed prompts |
| Schema too big for the provider's limits (Claude: 24 optional parameters) | Spec designed with few optionals; split "understand" and "words" into two calls |
| The engine lays out legally but badly (cramped, odd angles) | Fixture renders reviewed by eye in T3/T4; the panel's "small edit" reasons feed the engine, not only the prompts |
| Cost spikes | Credits per plan (amounts decided later); cache the schema and examples; cap retries at 1 |
| Over-asking the coach | Questions ≤ 3, every one with a default; "assumed" strip instead of a question wherever a sensible default exists |

## 9. What's deliberately not in scope

Session plans, periodisation, books, photo-of-whiteboard, player-facing AI, match video. The spec and engine are built so these can reuse them later, but nothing here depends on them.

## 9a. Relationship to the existing AI module

The owner's instruction is a clean rebuild: the old `tacticoach-api/src/modules/ai` (DSL compiler, validators, prompts, exemplars) is **not** carried forward, and its frontend calls (`editor/api.ts aiLayout / aiAnimation`, the AI panel) are replaced. Three things are worth keeping because they are plumbing, not AI, and replacing them would cost a migration for nothing: the `AiUsage` credits table and its `/ai-credits` route shape, the `AiCorrection` log table (reused for kept/changed/discarded), and the rate-limit split (production vs non-production). **Decision for the owner:** keep those three, or rebuild them too. The new module lives at `tacticoach-api/src/modules/assistant/`, and the frontend request becomes `{ prompt, mode, answers?, board? }` where `board` is the roles-and-numbers list from Section 5.1.

## 10. Implementation plan

Each ticket has its tests; nothing is "done" without them (definition of done applies). Estimated at one engineer; the coach reviewer is needed in T1 and T8.

| # | Ticket | What's in it | Done when |
|---|---|---|---|
| T1 | **Test set v1** | 350 prompts (50 per language) with answer specs and tolerances; 100 held out; eval runner skeleton reporting per language | `npm run ai:eval` runs and reports the 5 scores per language |
| T2 | **PracticeSpec + validator** | `tacticoach-api/src/modules/assistant/spec.ts` (zod + JSON schema), `validate.ts` (the rules from the examples' tests, on the shared motion plan) | Validator passes all 11 examples, fails 12 hand-made bad specs |
| T3 | **Layout engine** | `layout.ts`: groups → objects using formations/area/queues; flank bug fixed; templates.ts HOME_433 corrected | 30 spec fixtures render inside the lines, no overlaps, flanks right |
| T4 | **Animation engine** | `animate.ts`: phases → frames with timing, pass types, run kinds, teach | all fixtures pass the validator; motion plan tests green |
| T5 | **Provider adapter + Understand** | `llm/` (Gemini, Claude), prompt with retrieved examples, constrained JSON, the `ask` branch, name redaction | Intent ≥ 80% on the dev set (first bar); redaction tests |
| T6 | **Words** | captions, step names, coaching points in 7 languages | Rubric ≥ 4/5 on 30 boards |
| T7 | **Route + credits + log** | `POST /assistant/board` (sync, ≤ 8 s) taking `{ prompt, mode, answers?, board? }`, credits (reusing `AiUsage` if the owner agrees), kept/changed/discarded log, rate limits (prod vs dev split), provider retention choice implemented | API tests from the test map; player lockdown confirmed |
| T8 | **Editor UI** | Ask button and panel, voice with transcript shown first, questions as chips, draft overlay with assumed strip, Keep/Change/Discard, opt-in tick for the library, 7 locales, themed | Unit tests (themed, copy parity), live Playwright spec `assistant.spec` |
| T9 | **Retrieval + learning loop** | embeddings of examples and opted-in boards; A/B on the holdout with and without retrieval; weekly report | Intent ≥ 90% overall / ≥ 85% per language on the holdout; kept-rate dashboard in Admin |
| T10 | **Remove the old AI** | delete `src/modules/ai`, old flags, old copy | no references; full suites green |
| T11 | **Launch gate** | all five gates met on the holdout; panel rating done; privacy wording reviewed; coach acceptance review; deploy note | owner sign-off |

Order: T1 → T2 → T3 → T4 (all deterministic, no AI yet; the engine can be demoed with hand-written specs) → T5 → T6 → T7 → T8 → T9 → T10 → T11.

## 11. Decisions needed from the owner

1. Approve this design (then tickets T1–T4 start, with no AI spend).
2. Provider: Gemini 3.8 Flash first, Claude as the A/B. Yes?
3. Retention: accept Google's short abuse-monitoring logs of redacted prompts, or set up Vertex AI for guaranteed zero retention?
4. Keep the old credits table, correction log and rate-limit split (plumbing), or rebuild them too?
5. Who writes the 350 answer specs with me: you, a panel coach, or both (native speakers for the 7 languages)?
6. Credits per plan: decide before T7, not now.

---

## Sources

- Google, Gemini structured output (read 19 Oct 2026): https://ai.google.dev/gemini-api/docs/structured-output
- Google, Gemini API pricing (read 19 Oct 2026): https://ai.google.dev/gemini-api/docs/pricing
- Anthropic, structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic, pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Google, zero data retention in the Gemini Developer API: https://ai.google.dev/gemini-api/docs/zdr
- Anthropic, API and data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Stechly, Valmeekam, Kambhampati, on the limits of LLM self-verification (ICLR 2025): https://proceedings.iclr.cc/paper_files/paper/2025/file/f3c5e56274140e0420baa3916c529210-Paper-Conference.pdf
- Constrained decoding eliminates structural failures but reveals a semantic gap (2026): https://arxiv.org/pdf/2609.23742
- When JSON is not enough: semantic reliability of schema-constrained agents (2026): https://arxiv.org/pdf/2607.18261
- MLflow, structured output patterns: https://mlflow.org/articles/structured-outputs-llm/
- Grammar prompting for DSL generation (NeurIPS 2023): https://neurips.cc/virtual/2023/poster/72512
- Baumann et al., RAG + few-shot for uncommon DSLs (2024): https://www.se-rwth.de/publications/Combining-Retrieval-Augmented-Generation-and-Few-Shot-Learning-for-Model-Synthesis-of-Uncommon-DSLs.pdf
- TacticAI (Nature Communications 2024): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951310/
- TacEleven (arXiv, Nov 2025): https://arxiv.org/abs/2511.13326v1
- Internal: `tacticoach-frontend/src/editor/{templates,areaLayout,formations,steps,motionPlan,teach,queues}.ts`, `tests/unit/templateBeats.test.ts`; `TACTICAL_COACH/AI/AI_Strategy_Research_2026-10-19.md`.
