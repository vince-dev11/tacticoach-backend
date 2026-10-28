-- TRIAL-FEEDBACK (27 Oct 2026, product review): the 14-day trial now shows the
-- feedback loop — one squad and five feedback notes, counted by creation like
-- the trial's other allowances. Additive: a new counter, default 0.
ALTER TABLE `free_usage` ADD COLUMN `feedback_notes` INT NOT NULL DEFAULT 0;
