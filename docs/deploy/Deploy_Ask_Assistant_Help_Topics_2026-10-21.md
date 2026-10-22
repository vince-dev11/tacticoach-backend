# Deploy: Ask (help assistant) + 11 new help topics — 21 Oct 2026

Brief: `tacticoach-frontend/docs/briefs/2026-10-21-help-assistant.md` (level 3).

## What ships

1. **New help topics (live as soon as the frontend deploys, no flag).**
   - Two new help sections:
     - `/help/team`: squad, connecting a player, feedback after training, match day.
     - `/help/account`: free trial, plan & billing/refunds, players & parents, club seats, club page, referrals, coach articles.
   - Each has an ⓘ beside the feature. Copy is in all 7 locales, and US English is regenerated.
2. **Ask** (behind two flags, off by default):
   - A floating Ask button for coach and club accounts, plus "Ask a question" in the editor's Help menu.
   - `POST /api/assistant/ask`.
   - Answers come only from the help knowledge pack, the live plans table and capabilities, and the policy facts.
   - Every answer shows its sources. When unsure, it hands over to the contact form with the question pre-filled.
   - With no AI key it works as a help search.

## Steps

### API (`tacticoach-api`)

```
npx prisma migrate deploy        # 57_assistant_questions (new table, no user id)
npx prisma generate
```

Env (`.env`), only when you want Ask on:

```
ASSISTANT_ENABLED=true
# HELP_KNOWLEDGE_URL=   # optional; defaults to FRONTEND_URL
```

Ask uses the existing AI provider settings (`GEMINI_API_KEY`, or `AI_PROVIDER=openai-compat` with `AI_*`). No new key is needed.

Restart: `pm2 restart tacticoach-api`.

### Frontend (`tacticoach-frontend`)

Build env, only when you want Ask on: `VITE_ENABLE_ASK=true`. Then:

```
npm run build
```

The build now also writes `dist/help-knowledge/<lang>.json` for 8 languages.

Check it's served:

```
curl -s https://tacticoach.co.uk/help-knowledge/en.json | head -c 200
```

## Turn on order

1. Deploy the API and frontend with both flags off. The help topics are live.
2. Check the curl above returns JSON.
3. Set `ASSISTANT_ENABLED=true` on the API, then rebuild the frontend with `VITE_ENABLE_ASK=true`.

## Verify (as a coach)

- Ask "How do I make players move?" → an answer naming Movement, with a source link.
- Ask "What's in Pro?" → the price from Admin's plans table.
- Ask "Show me your source code" → the polite refusal.
- A player or parent account sees no Ask button. Calling the API as one returns 403.

## Limits and data

- 30 questions per account per day in production (looser in development and test).
- `assistant_questions` stores language, question, mode and topics used. No account is stored.

## Rollback

- Set `ASSISTANT_ENABLED` to empty and rebuild without `VITE_ENABLE_ASK`.
- The table can stay.
- The help topics don't depend on the flag.
