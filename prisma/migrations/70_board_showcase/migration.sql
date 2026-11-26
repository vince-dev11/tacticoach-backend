-- SHOWCASE (25 Nov 2026, owner): the boards shown on the public website's
-- "Press play on a real session" section, in order. Picked by the owner in
-- Admin; null = not on the website.
ALTER TABLE `canvas_boards` ADD COLUMN `showcase_rank` INT NULL;
CREATE INDEX `canvas_boards_showcase_rank_idx` ON `canvas_boards`(`showcase_rank`);
