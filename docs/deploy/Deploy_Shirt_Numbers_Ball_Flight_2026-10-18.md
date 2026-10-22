# Deploy: shirt numbers by country, and the ball's flight with round players (18 Oct 2026)

**Brief:** `Brief_Shirt_Numbers_Ball_Flight_2026-10-18.md`. **Frontend only**, so no API deploy is needed. Saved boards are unchanged.

## 1 · Shirt numbers that follow the coach's country (SHIRT-NUMBERS)

**What the coach saw (video, 18 Oct, app in Portuguese):** a 4-3-3 numbered the English way. 3 at left-back, 5 and 6 at centre-back, 4 holding. To a Brazilian coach that is wrong: their 3 and 4 are the centre-backs, 6 is the left-back and 5 holds.

**What changed:**

- **Formations ▸ Shirt numbers.** A new picker under Home and Away, with six styles:

| Style | Back four (RB · RCB · LCB · LB) | Midfield | Front |
|---|---|---|---|
| England | 2 · 5 · 6 · 3 | 4 (holds), 8, 10 | 7 · 9 · 11 |
| 6 · 8 · 10 (USA, Germany, France, Spain) | 2 · 4 · 5 · 3 | 6 holds, 8, 10 | 7 · 9 · 11 |
| Netherlands | 2 · 3 · 4 · 5 | 6 holds, 8 right, 10 left | 7 · 9 · 11 |
| Brazil | 2 · 3 · 4 · 6 | 5 (volante), 8, 10 | 7 · 9 · 11 |
| Argentina | 4 · 2 · 6 · 3 | 5 central, 8, 10 | 7 · 9 · 11 |
| Italy | 2 · 5 · 6 · 3 | 4 (mediano), 8, 10 | 7 · 9 · 11 |

  - All 12 shapes are covered, 11v11 down to 4v4.
  - Back threes follow the closest well-known side (Brazil 2002, the Netherlands 2014). Small-sided numbering is loose everywhere, so it follows the same pattern by position.
- **Default from the app language** (a best guess the coach can change): English → England; US English, German, French, Spanish and Turkish → 6·8·10; Italian → Italy; Portuguese → Brazil. The coach's pick is remembered on the device.
- **Changing the style renumbers the board at once.** It is one undo step. It only touches numbers a formation gave. **A coach's own labels and a squad's real shirt numbers are never changed.**
- **Bug fixed: left and right were swapped** in three small-sided shapes, in every language: 9v9 3-2-3, 7v7 2-3-1 and 5v5 1-2-1. The 2 and 7 were on the left, and the 3 and 11 on the right.
- **Bug fixed: changing shape now keeps each player in their position.** Going from 4-4-2 to 4-3-3, the right-back stays the right-back. Before, players moved by list order, so the 11 could land in the holding role. Positions the new shape doesn't have go to the nearest free slot.
- England's 3-5-2 centre: the deep midfielder is now the 8 (it was a 7 in the middle), with the 10 on the left and the 7 on the right.
- **Match Day** uses the same numbering.

### Revision after coach feedback (same day): "Brazil: 11 should be at the bottom, 7 at the top"

I checked every style against published sources: Wikipedia "Squad number (association football)", and Museum of Jerseys' histories of Brazil's and Argentina's numbering.

**The 7 and 11: no change.**

- In Brazil's numbering, **7 is the ponta direita (right winger) and 11 the ponta esquerda (left winger).** The same holds in England, continental Europe and Argentina.
- Our team attacks left to right, so its right side is the bottom of the screen. The 7 at the bottom is correct.
- Today's Seleção plays Vinícius Júnior (7) on the left and Raphinha (11) on the right. Those are *inverted wingers*: a player's choice of side, not the numbering. A coach who plays them that way can rename the two tokens.

**Fixed: Brazil's 4-4-2 was not the Brazilian 4-4-2.** It is now:

- Back four: 2 · 3 · 4 · 6.
- Midfield: 5 and 8 in the middle, 7 on the right, **10 on the left**.
- Front two: **9 and 11**. It was 11 on the left of midfield with 10 and 9 up front.

**Fixed: England's back four and strikers were the wrong way round.** The FA lists the 4-4-2 right to left as 2 5 6 3 · 7 4 8 11 · 10 9.

- So the 5 is the right centre-back and the 6 the left; the 10 is the right striker and the 9 the left.
- The 4-2-3-1 double pivot is now 4 right, 8 left.
- England's back three is now 6 · 5 · 4, left to right.

**Fixed: Argentina's 3-5-2 has the 8 at right wing-back,** as in 2006.

**New tests:**

- England's 4-4-2 exactly as listed.
- Brazil's 4-4-2 exactly as listed.
- Argentina's back four, right to left: 4 2 6 3.
- In every style and every shape, a wide 7 is on the right and a wide 11 on the left.

**Still the best available, not a standard:**

- The Netherlands' numbering. It is well known, but I found no official source.
- Every back three.
- Small-sided shapes.

## 2 · The ball's flight with round players in 3D / Stadium (BALL-AIR)

**Cause.**
- The flight was already there for round players: same passes, same height. I rendered both looks frame by frame to check.
- But the round players' ball is drawn about 7× life size (about 2.5 m across). A life-size 4 m lift was less than two of its own widths, so it looked as if it slid sideways.

**Fix.**
- With round players, the drawn height grows with the ball: at least about 4 widths at the peak, at most 6, so a long switch stays in view.
- The shadow stays clearer on the grass, because the shadow is what tells the eye the ball is up.
- **Real players, 2D, the timing and which passes fly are all unchanged.** Passes under 25 m still roll unless the coach picks **Lofted**.

## Checks run

- `npm run typecheck`: clean. eslint on every changed file: clean.
- **New tests:**
  - `shirtNumbers` (11): no number twice in any shape or style, left and right correct in every shape, each country's 4-3-3, England unchanged where it was right, the language default, Match Day, renumbering that keeps the coach's labels and is one undo step, and re-shape by position.
  - `ballAirTokens` (5).
- **Every test touching the store, formations, Match Day or the sidebar:** 65 files, 716 tests, all pass.
- **3D/Stadium, figures, realism, i18n, terminology and themed controls:** 26 files, 861 tests, all pass.
- **Rendered check:** the switch-of-play example drawn in 3D and Stadium with both looks. The round-player ball now arcs clearly over its shadow. The real-player picture is identical to before.

## Please run (on your Mac)

```
npm run test:e2e:live -- editor.spec
```

The new live test is "shirt numbers — 18 Oct". Switching to Brazil makes the left-back the 6 and the holder the 5; England puts them back.

## Deploy (web only)

```
cd tacticoach-frontend && git add -A && git commit -m "Formations: shirt numbers by country (6 styles), L/R fixes in 3 small-sided shapes, re-shape keeps positions; 3D: round-player ball flight reads clearly" && git push
# server
cd /var/www/html/tacticoach-frontend && git pull && bash scripts/deploy-web.sh
```

## After deploy (5 minutes)

1. Players ▸ Formations ▸ **Shirt numbers → Brazil**, then Home **4-3-3**: 6 at left-back, 5 holding, 3 and 4 at centre-back.
2. Rename the 9 to a name, then switch to **England**: the name stays and the others renumber.
3. Home **2-3-1** (7v7): the 2 and the 7 are on the right as the team attacks.
4. Ready-made drills ▸ **Switch of play**, round players, **3D**, then play: the ball rises over its shadow on the switch.

## Coach acceptance review (football-product-expert)

**For:** every coach using Formations, especially outside England. Also coaches showing passes in 3D with round players.

**Would I use it on Tuesday night?** Yes. A Brazilian, Dutch or Argentine coach now sees the numbers their players use, so "the 6" means the same thing on the board as in the changing room. The small-sided left/right swap was a real error that a 7v7 coach would have spotted at once, and it is fixed.

| Area | Verdict |
|---|---|
| Coach workflow | PASS. One picker, where formations are chosen. It renumbers at once and can be undone. |
| Football correctness | PASS for the back four and 4-3-3 conventions [Common practice]. Back threes and small-sided numbering are flagged as loose, not as rules. |
| Global | PASS. Six styles, a language default and the coach's choice wins. No style is tied to age. |
| Ease of use | PASS. Nothing changes for English coaches except the three fixed shapes. |
| Animation | PASS. The round-player flight reads as a flight; real players are untouched. |

**Solves the stated problems:** YES for both.

**Optional later:**
- Keep the numbering style on the coach profile, so it follows them across devices.
- A "role letters" style (GK, RB, CB…).
- The API's AI planner still numbers its boards the English way.
