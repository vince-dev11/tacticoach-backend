# Pricing page — the Basic card now says what Basic leaves out (9 Oct 2026)

Level 1 (pricing copy). Source of truth for what each tier grants: `tacticoach-api/src/lib/capabilities.ts`.

## Why
Since 6 Oct the free trial is a taste of **Pro** (3D and Stadium, ball sounds, connected players, HD video, social export). The Basic card still opened with "Everything in Free", which was no longer true, and its struck-through line only named HD, 3D/Stadium, branding and publishing — a Basic coach could still meet a locked ball-sound, connected-players or social-export button, or the one-squad limit, without having been told.

## Basic — what the code grants
Editor (2D), animation + video export at 720p with watermark, 10 a month · unlimited boards and drill sheets · session builder and season planner, 12 sessions · 1 squad with player feedback · 3 books (draft only).
Not granted: `board_3d`, `ball_sound`, `connected_players`, `video_hd`, `social_export`, `own_branding`, `guardian_copies`, `ai`, `publish_ebooks`, `multi_squad`.

## The card now (`src/lib/pricing.ts` + `prices.basic_*` in the 7 landing locales, en-US regenerated)
1. Tactics board in 2D — every pitch, animated
2. Unlimited boards and drill sheets
3. Animation + video export (720p with watermark, 10 a month)
4. Session builder and season planner, up to 12 sessions
5. One squad, with session feedback to your players
6. Write up to 3 books
7. ~~Not in Basic: 3D and Stadium, ball sounds, connected players, HD and social video, your own badge, publishing, more squads~~

Pro line 5 reworded to "Unlimited sessions in the season planner" (Basic has the planner too, capped at 12 sessions).

## Checks
`pricing`, `proGate`, `i18n` (7-locale parity), `terminology` (en-US overlay), `noHardcodedCopy`, `localizeHtml` tests pass; typecheck clean. Not changed: prices, the API table, the Free/Pro/Club cards' other lines.
