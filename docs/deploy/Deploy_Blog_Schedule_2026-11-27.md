# Deploy note: scheduled blog posts (27 Nov 2026)

API and web app. **No migration** and no background job.

## What ships

**Scheduling (owner: "schedule a blog post and it posts at that date and time")**

- Admin → Blog → a post: a **Publish at** date and time box (your local time).
  - With a future time the button reads **Schedule**; the post is saved as published with that time.
  - Empty box = publish straight away, as before.
  - To publish a scheduled post now: clear the box and press **Update & publish**.
  - To move it: change the time and press **Schedule**.
- The list shows **scheduled · date, time** and no View link until its time.
- Until its time the post is hidden everywhere public: the blog list, its own link ("not found"), the RSS feed and the blog sitemap. At its time it appears by itself.
- How: every public read asks for posts whose publish date has arrived (`livePosts()` in `blog.routes.ts`). Nothing runs on a timer, so a restart can't make a post miss its time.

**Bug fixed on the way (BLOG-PATCH-DEFAULTS)**

- Saving only some fields of a post filled the rest with empty defaults. "Approve & publish" on a coach's article saves the SEO fields first, which **emptied the article's content and tags and set it back to draft**. The coach's own editor had the same fault on a partial save.
- Both now keep only what was sent (`sentOnly`, the helper the book editor already used).
- **Check after deploy:** open any coach article approved recently and confirm its text is still there.

## One thing to know (search engines)

A scheduled post is live for visitors and in the blog sitemap at its time. The **static copy** that search engines and AI crawlers read best (and its line in `llms.txt`) is made when the web app is built, so it appears with the next web deploy after the post's time.

## Tests

- API: `tests/blog-schedule.test.ts` (new), `blog-v4`, `admin`, `coach-articles` updated.
- Web: `tests/unit/blogSchedule.test.ts` (new).
- Checked by hand on the local site: scheduled a post 2 minutes ahead; hidden before, live 13 seconds after its time.
