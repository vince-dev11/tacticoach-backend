-- 43_session_description: a one-line description on a training session
-- (coach feedback, 1 Oct 2026: "coaches need a title AND a description on
-- the day"). Nullable — every session saved before reads exactly as it did.
ALTER TABLE `training_sessions` ADD COLUMN `description` VARCHAR(300) NULL;
