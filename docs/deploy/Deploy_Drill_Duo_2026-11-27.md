# Deploy note: "One drill. Two ways to show it." on the home page (27 Nov 2026)

Web app only. No API change, no migration.

## What ships

- **Home page:** a new section after the product section, showing the owner's two exports of the same drill side by side: on the 2D board and in the Stadium.
  - Both are silent, loop, and start only when the section scrolls into view; they pause when it leaves.
  - One button plays and pauses both, and the Stadium video follows the board's clock so they stay in step.
  - Visitors with "reduce motion" turned on see the two pictures and press play themselves.
- **Files** in `public/media/`: `drill-2d.mp4` (0.9 MB), `drill-stadium.mp4` (4.4 MB), and a poster picture for each. Made from the originals in `TACTICAL_COACH/` (6 MB and 63 MB) at 960×540, without sound.
- Copy in 7 languages (`site.duo.*`). Test: `tests/unit/drillDuo.test.tsx`.

## Steps

1. Deploy the web app. No nginx change: the page may already play its own video files (`media-src 'self'`).
2. Check the home page on a phone: the two videos stack one above the other.

## To change the videos later

Replace the four files in `public/media/` (same names). Keep both videos the same length, or they will not stay in step.
