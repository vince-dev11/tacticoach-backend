-- Board labelling for the library filters today and model training tomorrow:
--  * tags             — optional coach-chosen categories (chip row after save)
--  * context_snapshot — the coach's age group / format / level / formation at
--                       save time, attached silently server-side
ALTER TABLE `canvas_boards` ADD COLUMN `tags` JSON NULL;
UPDATE `canvas_boards` SET `tags` = '[]' WHERE `tags` IS NULL;
ALTER TABLE `canvas_boards` MODIFY `tags` JSON NOT NULL;
ALTER TABLE `canvas_boards` ADD COLUMN `context_snapshot` JSON NULL;
