# Deploy — blog on the public site (BLOG-V4), 19 Nov 2026

Order: API first, then the frontend.

1. API: `git pull`, `npm install`, `npx prisma migrate deploy` (applies
   `67_blog_practice`: three nullable columns on `blog_posts`), `npx prisma generate`,
   restart. Old posts are untouched (the new fields are empty).
2. Frontend: `bash scripts/deploy-web.sh`. Reload nginx only if the script asks.
3. Check: `/blog` shows the topic chips and the Format select; an article with the
   practice box filled in shows it; the home page shows "From the touchline" once
   one post is published.

No new environment variables. Rollback: the columns are nullable and unused by
older code, so the previous build runs against the new schema.
