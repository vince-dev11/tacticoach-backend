-- Library cards need to say "Animation ready" vs "Static board" without the
-- API loading each board's (large) state JSON per row. Stamp it at save time.
--
-- Backfill: a board is animated when any saved frame carries movement steps.
-- The saved shape is state.frames[i].objects[j].steps — a non-empty frames
-- array with any objects is a close, cheap proxy for existing rows; new saves
-- compute it exactly.
ALTER TABLE `canvas_boards` ADD COLUMN `has_animation` BOOLEAN NOT NULL DEFAULT false;
UPDATE `canvas_boards`
SET `has_animation` = true
WHERE JSON_LENGTH(JSON_EXTRACT(`state`, '$.frames')) > 0;
