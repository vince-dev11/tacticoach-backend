# Hosting and backend review (5 Oct 2026)

## 1. What runs today (from `DEPLOY_RUNBOOK.md`)

**One AWS EC2 box** (`13.53.60.120`, Stockholm, eu-north-1) runs everything:

- the API (Node and pm2);
- MySQL 8;
- nginx, serving the frontend.

**Media** lives in **S3**: thumbnails, preview videos, logos, sheet images and book covers. The browser fetches them through presigned URLs.

**Other services:** Stripe, SMTP, Gemini, Sentry and PostHog. None of these depend on AWS.

So moving host means moving one Ubuntu box plus the S3 bucket. Nothing is locked to AWS except the S3 SDK, and that also talks to S3-compatible storage (Cloudflare R2, Hetzner Object Storage, DigitalOcean Spaces) by setting an endpoint.

## 2. Where the AWS money usually goes (check this first)

Before moving, open **AWS Billing → Cost Explorer**, group by **Service**, and then by **Usage type** for the last 3 months. On a setup like this the bill is normally a mix of:

- **EC2 instance hours.** Size matters: a t3.large costs about twice a t3.medium.
- **EBS disk and snapshots.**
- **Public IPv4.** AWS charges for every public IPv4 address, about $3.60 a month each.
- **Data transfer out:** traffic from EC2 or S3 to the internet, around $0.09/GB. Videos and thumbnails make this grow with users.
- **S3** storage and requests (usually small).

Send me that breakdown (or a screenshot) and I'll turn the estimates below into exact savings.

## 3. Options

Prices were checked online on 5 Oct 2026, excluding VAT. Hetzner raised cloud prices on 15 June 2026; the figures below are the new ones.

| Option | Server | Price/month | Traffic included | Media storage | Effort to move | Notes |
|---|---|---|---|---|---|---|
| **A. Hetzner Cloud (Germany/Finland) + Cloudflare R2** | CX33: 4 vCPU, 8 GB (or CX43: 8 vCPU, 16 GB) | **€8.49** (CX43 €15.99) | 20 TB | R2: $0.015/GB, **no egress fees** | Medium: a new box, copy the DB and bucket | The cheapest by far. EU, so GDPR is fine. About 20–30 ms further from UK users than London. Backups are +20%. You manage the server yourself, as today. |
| **B. DigitalOcean (London)** | 4 vCPU, 8 GB | **$48** (2 vCPU, 4 GB: $24) | 5 TB / 4 TB | Spaces, from $5/month (250 GB, 1 TB out) | Medium | A London data centre, closest to UK coaches. Simple panel, extra traffic $0.01/GB. |
| **C. AWS Lightsail (London)** | 2 vCPU, 8 GB | **$44** (4 GB: $24) | 5 TB / 4 TB | stays on S3, or Lightsail buckets | **Lowest**: same AWS account | Fixed monthly price with traffic included, so no surprise transfer bills. A good "stay on AWS but cheaper" step. |
| Keep EC2 | as today | depends on size | none: every GB out is paid | S3, egress paid | none | Only worth it if Cost Explorer shows the bill is already small. |

**My recommendation:**

- **Cheapest: option A.** Hetzner CX33 (or CX43 for headroom), Cloudflare in front (free plan), and media on Cloudflare R2. For a product at our stage that's roughly **€10–25 a month all-in**. Zero egress fees on R2 matters, because coaches download and share videos.
- **If you'd rather not leave AWS, or want London: option C.** Lightsail London is the smallest change and gives a fixed price.
- **In both cases, put Cloudflare (free) in front** of the site and the media. It caches static files and images at the edge, cutting traffic from the server.

Whichever you pick, do the backend fixes in section 4 first. Two of them cut traffic, and so cost, on any host.

## 4. Backend review: are requests optimised?

The API is in good shape overall:

- list endpoints use card-sized `select`s (not whole boards) and pagination;
- indexes exist where the lists sort (`[userId]`, `[published, publishedAt]`);
- rate limiting is on;
- CORS preflights are cached for 2 h;
- per-route timings are recorded (Admin → Health);
- static frontend assets are cached for a year.

What I'd fix, most valuable first:

| # | Finding | Why it costs money or speed | Fix | Effort |
|---|---|---|---|---|
| 1 | **Media URLs change on every request.** `presignUrl` signs each thumbnail, video and photo for 15 minutes, freshly each time a list loads (41 call sites). | The browser can never reuse a cached image: every library visit downloads every thumbnail again from S3. That's paid egress, and slower pages. | Keys are already unique (`thumb-<timestamp>`), so files never change. Upload with `Cache-Control: public, max-age=31536000, immutable`, then either serve media through a CDN domain (CloudFront, or R2 behind Cloudflare) or sign with a fixed daily window so the URL stays the same all day. Private media keeps signed URLs; public library thumbnails can be public. | Small–medium |
| 2 | **API responses aren't compressed in the app** (no `@fastify/compress`). Whether production nginx compresses JSON isn't in the repo. | A board's saved state is JSON that can be hundreds of KB; gzip cuts JSON by about 80–90%. | On the server, check `curl -sI -H 'Accept-Encoding: gzip' https://api.tacticoach.co.uk/api/plans` for `content-encoding: gzip`. If it's missing, add `gzip_types application/json;` to the API's nginx site, or register `@fastify/compress`. | Small |
| 3 | **`limit` isn't capped** on `GET /canvas/boards`, `/canvas/library` and `/drill-sheets`; the blog caps it at 50. | `?limit=100000` makes the API load and sign every board in one request. A cheap way to slow the server, accidentally or not. | `Math.min(50, Math.max(1, Number(limit) \|\| 20))`, and the same for `page`. | Tiny |
| 4 | **pm2 runs one process.** | With more than 1 vCPU, one Node process leaves the others idle, and a slow request blocks everyone. | `pm2 start dist/index.js -i 2` (cluster mode) once the box has 2+ vCPUs. Note: the rate limiter is in-memory per process, so limits become per process. That's fine at our size. | Tiny |
| 5 | **Every signed-in request reads the user row** (player guard) and checks the JWT twice. | One indexed primary-key read per request, cheap today. It only matters at much higher traffic. | Leave it. The code comment already explains the safety reason. Revisit if Admin → Health shows it. | — |
| 6 | **Frontend page weight:** the largest chunks are `seo` 668 KB, `index` 492 KB, `Tour` 460 KB, `jspdf` 384 KB, and about 200 KB per language. | Not a server cost (nginx and the CDN serve them), but slower first loads on phones at the training ground. | Check what `seo` pulls in (it may be the prerender data), and load `Tour` and `jspdf` only when used. | Medium |
| 7 | **MySQL on the same box as the API.** | Fine at our size and cheapest. The risk is backups and the disk. | Keep the nightly backup (`scripts/nightly-backup.sh`) going to object storage *off* the box (R2 or S3), and test a restore once. | Small |

Fixes 1–3 are small code changes I can make; tell me which. Fix 4 is a server command you'd run.

## 5. The plugin you asked about

`/plugin install mcp-server-dev@claude-plugins-official` adds skills for **building MCP servers**: tools that let Claude (or another AI app) talk to a service. It doesn't help choose hosting or speed up the API.

It would be useful later if you want a **TactiCoach MCP server**, for example so a coach can ask Claude to "make a 4v2 rondo board in my library". You install it yourself in Claude Code's terminal (`/plugin …`); I can't run that command here. Not needed for this decision.

## Sources

- [Hetzner: price adjustment, 15 June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Cloudflare R2 pricing 2026 (egresscost.com)](https://egresscost.com/cloudflare/)
- [Amazon Lightsail instance bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
- [DigitalOcean droplet pricing 2026 (Fluence)](https://fluence.ai/blog/digitalocean-droplets-vs-fluence/)
