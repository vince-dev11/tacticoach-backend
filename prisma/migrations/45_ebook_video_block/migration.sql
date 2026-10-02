-- Video lessons in books and courses: a YouTube or Vimeo LINK (no uploads).
-- The block stores provider + video id; the reader builds the embed itself.
--
-- Additive only: MySQL appends the new enum value without touching existing
-- rows. Same pattern as migrations 29 and 36.

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
    'chart',
    'video'
  ) NOT NULL;
