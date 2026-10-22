# API docs

| Folder | What |
|---|---|
| `deploy/` | Deploy runbook and one note per release (what changed, migrations, env, commands, verify, rollback). Write a new note for every release. |
| `setup/` | Stripe and email (Brevo), admin analytics, analytics accounts, error tracing, hosting cost and backend review |
| `ai/` | Editor AI strategy and design plan |
| `briefs/` | Briefs for API-heavy features (family accounts, player/parent sign-up) |
| `planning/` | Pricing card |

Feature briefs, reviews and the glossary live in the frontend repo's `docs/`. Business documents (legal, marketing, brand, videos) are in `TACTICAL_COACH`, outside git.

Rules: no keys, passwords or customer data in any doc. Update a doc in the same commit as the code it describes.
