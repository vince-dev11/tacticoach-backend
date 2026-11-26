# Deploy note: "Press play on a real session" on the website (25 Nov 2026)

Design: `TACTICAL_COACH/02_Marketing/Watch_A_Session_Design_2026-11-25/` (approved by the owner on 25 Nov).

## What ships

**API**

- Migration **`70_board_showcase`**: adds the column `canvas_boards.showcase_rank` (nullable, indexed). Nothing else changes.
- `GET /api/share/showcase` (public):
  - returns up to 6 picked boards that are **still published**, in order;
  - sends title, age group, coach, club and picture, with **no board data**;
  - can be cached for 5 minutes.
- `GET` and `PUT /api/admin/showcase` (owner only). Private boards are refused, as are more than 6 boards or the same board twice.

**Web**

- Home page: the "Press play on a real session" section, after "How it works":
  - it is hidden until at least one session is picked;
  - a board loads through `/api/share/board/:id` only when a visitor presses play, and players' names are removed by the API, as on share links;
  - visitors can watch in 2D, 3D and Stadium;
  - the button leads to early access (or sign-up once it opens);
  - the `showcase_play` analytics event is counted only after cookie consent.
- **Admin → Website**:
  - paste a board's share link or number;
  - reorder with Up and Down, or remove;
  - Save.
- Copy is in all 7 languages (`site.watch.*`).
- `LiveBoardPlayer` gained `autoPlay`: the board starts right after the website's own play button.

## Steps

1. `npx prisma migrate deploy` (migration 70), then `npx prisma generate`.
2. Deploy the API, then the web app.
3. **Admin → Website:** add 3–4 of the best **public** boards. The website shows the section as soon as you save.

## Before you add a board

- **Names:** the players' names are removed automatically. **Check the title and any text drawn on the board** don't name a child.
- **Consent:** make sure the coach is happy for the board to be shown.
- **Keep it moving:** pick boards that have movement (an animation). A still board shows only its picture.
