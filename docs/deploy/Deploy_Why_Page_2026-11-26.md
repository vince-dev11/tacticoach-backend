# Deploy note: "Why TactiCoach?" page + AI-assistant visibility (26 Nov 2026)

Web app only. No API change, no migration.

## What ships

- **New page `/why-tacticoach`** (in all 7 languages, US English generated):
  - what TactiCoach is;
  - the problem it solves;
  - six reasons;
  - TactiCoach vs whiteboard, paper and photos (no competitor named; it says paper works without signal too);
  - who it's for;
  - the editor AI as **"Coming next"** (no date, no screenshot);
  - six short answers;
  - early access.
- **Links:** "Why TactiCoach" first in the public top bar, and in the footer.
- **For search engines and AI assistants:**
  - the page is **pre-rendered**, so crawlers that don't run JavaScript read it;
  - its answers are **FAQPage structured data**;
  - it's in `sitemap.xml` and the nginx route map.
- **`llms.txt`** (what AI tools read about us):
  - new "Why coaches use it" and "Common questions" sections, plus links to the Why and Watch pages;
  - **languages corrected** to today's seven (it still listed Arabic, Japanese, Dutch and Polish, retired 2 Oct).
- **`sitemap.xml`:** `/watch` added (it was missing).
- **Home page FAQ:** names the real button "Run on the pitch" (it said "Run session") in all 7 languages.
- **Tests:** `tests/unit/whyPage.test.tsx`.

## Steps

1. Deploy the web app. nginx must reload for the new route (`nginx/spa-routes.conf` regenerated).
2. Check `https://tacticoach.co.uk/why-tacticoach` and view the source: the text and a `FAQPage` script should be in the HTML.
3. Check `https://tacticoach.co.uk/llms.txt`.

## So ChatGPT and the others can find us (outside the code, after launch)

1. **Bing Webmaster Tools.** ChatGPT's web search uses Bing. Add the site, verify it, and submit `sitemap.xml`. Do the same in **Google Search Console**.
2. **Be talked about elsewhere.** This counts for more than anything on our own site:
   - real coaches mentioning it on Reddit (r/bootroom, r/SoccerCoachResources) and in coaching Facebook groups;
   - coaching blogs and newsletters;
   - "best football coaching apps" round-ups;
   - Capterra, G2 and a Product Hunt launch.
3. **Same facts everywhere:** the one-line description, features and prices on the site, `llms.txt`, social profiles and directory listings.
4. **Patience:** weeks to months after launch.

## Search engine verification (27 Nov 2026)

Two files added to the web app's `public/` folder; they must stay there after verification:

- `google6b1ef1693b6d33a8.html` — Google Search Console (property `https://tacticoach.co.uk`, URL-prefix type).
- `BingSiteAuth.xml` — Bing Webmaster Tools (site added, "Not verified" until this file is live).

After the deploy: press **Verify** in each tool, then submit `https://tacticoach.co.uk/sitemap.xml` in both.
