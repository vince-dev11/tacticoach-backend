# Deploy — Activity log and analytics dates (23 Nov 2026)

## What ships
- **ACTIVITY-LOG** (API + app): our own record of what coach and club accounts do (product events + screens, ids stripped). Players, parents and the owner account are never recorded. Kept 13 months (daily sweep), deleted with the account.
- **Admin → Analytics**: new tabs Usage, Coaches (per-coach timeline), Retention, Where coaches stop, Traffic (GA4 channels / sources / landing pages + leads by channel). Every tab takes Last 7/30/90 days or **Pick dates** (from–to).
- Privacy Policy: new "Activity in TactiCoach" lines (date 23 Nov 2026).

## API
1. `git pull`
2. `npx prisma migrate deploy` — applies `68_activity_events` (new table `activity_events`, FK to `users` ON DELETE CASCADE).
3. `npx prisma generate`
4. `npm run build` and restart.
No new env variables. Traffic tab uses the existing GA4 settings (`GA4_PROPERTY_ID` + service-account key); without them it says "not connected".

## Frontend
`npm run build` and upload as usual. No new env variables.

## Check after deploy
- Sign in as a test coach, save a board → within ~5 s a `POST /api/activity` returns 202 `{recorded: n}`.
- Admin → Analytics → Usage shows today's activity; Pick dates re-queries with `?from=&to=`.
- A player account sends nothing (no `/api/activity` calls).
