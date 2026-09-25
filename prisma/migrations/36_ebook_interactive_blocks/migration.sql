-- Three block kinds that make a book do what paper cannot.
--
--   animation — a board whose moves play on the page, looping, with a scrubber
--   decision  — "What would you do?": a frozen moment, options, the answer plays
--   chart     — bar / line / pie / radar from a small table
--
-- Additive only: MySQL appends the new enum values without touching existing
-- rows. Same pattern as migration 29.

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
    'quote',
    'animation',
    'decision',
    'chart'
  ) NOT NULL;
