# Deploy: coach articles with admin review and SEO keywords (20 Oct 2026)

**Owner's decisions:** all coach plans can write (trial included); SEO keywords go in meta tags only; build now.
**Level 3** (football-product-expert). API **and** web deploy; one migration.

## What a coach gets

- **My articles** (`/articles/mine`), from a dashboard card ("My articles", amber) and from the blog page ("Write an article").
- The same markdown editor the team uses: title, short summary, topics, cover image, article body with live preview. **No slug and no SEO fields**: those are the admin's.
- **Save draft** and **Submit for review**. Submitting asks first: "Please check it names no child and nothing you don't have permission to share."
- Statuses a coach sees: Draft · Waiting for review · Sent back (with the reviewer's note) · Not published (with the note) · Live.
- A coach can **withdraw** a pending article, **edit** at any stage (editing a live article sends it back to review and takes it off the blog until re-approved; the button says so), and **delete** anything that is not live.
- Emails: approved ("Your article is live"), sent back or rejected (with the note).
- On the blog, a coach's article carries their **byline** ("By Ana Silva") linking to their coach page, and the Article JSON-LD names them as the author.

## What the admin gets

- **Admin → Blog**: filter chips (All · **Pending review (n)** · Published · Sent back · Drafts · Rejected), an Author column, pending articles first, and a **Review** button on pending ones.
- In the editor of a coach's article: a **review box** (author with a link to their page, a note field, **Approve & publish** · **Send back** · **Reject**). Send back and reject need a note.
- **SEO keywords** (comma-separated, up to 15) on every post, team or coach. Approve saves the SEO fields first, so the keywords go live with the article.
- Keywords appear as `<meta name="keywords">` on the post page only, and are removed on other pages.

## API

- Migration `55_coach_articles`: `PostStatus` gains `pending`, `changes_requested`, `rejected`; `blog_posts` gains `author_kind`, `seo_keywords`, `submitted_at`, `reviewed_at`, `review_note`, and an index on `author_id`.
- New `src/modules/articles` under `/api/articles`: `GET /mine`, `GET /mine/:id`, `POST /`, `PATCH /:id`, `POST /:id/submit` (needs a title and ≥ 200 characters), `POST /:id/withdraw`, `POST /:id/cover`, `DELETE /:id` (409 if live). Every route checks the article is the caller's.
- Admin: `PATCH /admin/blog/:id/review { action: approve|changes|reject, note?, seoKeywords? }`; `seoKeywords` accepted on create and patch; the list returns `author` and sorts pending first.
- Public `/api/blog`: cards and posts carry `author { name, coachSlug } | null` and the post carries `seoKeywords`; the review trail never leaves the server.
- **Players and parents are refused** (deny-by-default lockdown; tested).
- Shared helpers moved to `blog/blog.shared.ts`; three new email kinds.

## Checks run

- **API:** typecheck clean; `coach-articles.test.ts` (11 new) plus admin, player-lockdown, emails, club-branding and coach-page suites: **123 tests pass**. The migration SQL and schema are checked by test (no database in the sandbox).
- **Web:** typecheck clean; eslint clean on every changed file. `coachArticles.test.tsx` (9 new). Area suites (admin, blog, dashboard, i18n parity, terminology, hard-coded copy, themed controls, routes, SEO build): **591 + 22 + 7 tests pass**. `MyArticles.tsx` is now on the themed-controls guard's list.
- 7 locales via `i18n-add.py` (53 keys), English (US) regenerated; `nginx/spa-routes.conf` regenerated for the two new routes.
- **Not verified:** the screens in a real browser (no browser in this session). The live Playwright spec below covers the journey; please run it.

## Please run (on your Mac)

```
cd tacticoach-api && npx prisma generate && npx prisma migrate deploy && npm run dev
cd tacticoach-frontend && npm run test:e2e:live -- articles.spec
```

`articles.spec` (new): ART-01 the coach writes and submits (no slug/SEO on the form) · ART-02 not public while pending, a player gets 403 · ART-03 the owner filters Pending, adds keywords, approves; byline and meta keywords on the blog · ART-04 send back with a note, the coach sees it · ART-05 tidy up. ART-03/04 need `E2E_OWNER_EMAIL/PASSWORD` in `.env.e2e`.

## Deploy

```
# API first (migration)
cd tacticoach-api && git add -A && git commit -m "Coach articles: review states, SEO keywords, /api/articles, admin review + emails" && git push
# server: cd /var/www/html/tacticoach-backend && git pull && echo y | NODE_OPTIONS=--max-old-space-size=1024 bash scripts/deploy-api.sh   (runs prisma migrate deploy)
cd tacticoach-frontend && git add -A && git commit -m "Coach articles: My articles page, admin review + SEO keywords, bylines" && git push
# server: cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
```

## After deploy (5 minutes)

1. As a coach: Dashboard → **My articles** → New article → save → Submit for review → the confirm asks about children's names → status "Waiting for review".
2. As owner: Admin → Blog → **Pending review (1)** → Review → add keywords → **Approve & publish** → the coach's email arrives.
3. Open the post on `/blog`: byline links to the coach page; view source shows `<meta name="keywords">`.
4. Send one back with a note: the coach sees the note on My articles.

## Coach acceptance review (football-product-expert)

**For:** any coach who wants to share their work and be found; the owner as editor.

**Would I use it on Tuesday night?** Yes, after training: the editor is the one I already know from books, saving is one click, and I know the team will read it before it goes out. The byline to my coach page is the reason to bother.

| Area | Verdict |
|---|---|
| Coach workflow | PASS. Write → submit → emailed. Statuses in plain words; the reviewer's note is where the coach looks. |
| Safety | PASS. Nothing public without approval; the submit confirm asks about children's names; the admin is told to check again; players/parents refused by API and route guard. |
| Ease of use | PASS. No slug or SEO decisions for the coach; the admin's extra work is one field and one button. |
| Global | PASS. 7 locales; nothing country-specific. |

**Important (fix next, not blocking):** editing a live article takes it off the blog until re-approved. A coach fixing a typo loses the page for a day. The better rule is a pending *revision* with the live copy staying up; it needs a second content column, so it was left out of this pass. The button copy says what happens.

**Optional:** a "Related articles" block from shared keywords; a word count on the editor; AI help with drafting once the AI rebuild lands.

**Verdict:** Ship after `articles.spec` is green.
