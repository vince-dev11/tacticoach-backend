-- Guided tours a user has completed, e.g. ["editor","sheet"].
--
-- Stored on the ACCOUNT rather than in localStorage so the first-login tour
-- shows exactly once per coach — not once per browser, and not again after
-- clearing site data. JSON array so adding a new tour is a code change, not
-- a migration.
--
-- Three steps (add NULL -> backfill -> tighten) so the migration works on a
-- table with existing rows on both MySQL and MariaDB.
ALTER TABLE `users` ADD COLUMN `tours_done` JSON NULL;
UPDATE `users` SET `tours_done` = '[]' WHERE `tours_done` IS NULL;
ALTER TABLE `users` MODIFY `tours_done` JSON NOT NULL;
