-- The visual block kinds.
--
-- A coaching book is not prose with the occasional picture — it is diagrams
-- with the occasional paragraph. These three exist because the single `board`
-- block could not express what coaches actually draw:
--
--   board_compare  — two boards side by side ("9v9 becomes 11v11")
--   board_sequence — one board across several of its animation frames, as
--                    panels, so a move is told as a strip rather than a video
--   drill          — a board with Setup and Coaching Points beside it, the
--                    layout every session plan in the sport already uses
--
-- Enum values rather than a `mode` field inside the JSON: the reader switches
-- on `kind` and so does the editor, and a kind that is invisible to both until
-- you parse its data is a kind neither can validate.
--
-- Additive only. Existing rows keep their kind, and MySQL appends the new
-- values without rewriting the column's existing data.

ALTER TABLE `ebook_blocks`
  MODIFY `kind` ENUM(
    'text',
    'board',
    'board_compare',
    'board_sequence',
    'drill',
    'character',
    'your_turn',
    'quiz',
    'image',
    'quote'
  ) NOT NULL;
