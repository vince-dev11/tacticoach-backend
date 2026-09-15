-- Session planner redesign: season → week → session.
--
-- The existing training_sessions table stores the smallest unit of a coach's
-- job and none of the context around it. This adds the two levels above it and
-- the fields each session needs to roll up into them.
--
-- Nothing is destructive. Every new column on training_sessions is nullable or
-- defaulted, so a session saved before the planner existed stays valid and
-- behaves exactly as it did — it is simply a session with no week.

CREATE TABLE `season_plans` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `age_group` VARCHAR(16) NULL,
  `season_label` VARCHAR(40) NULL,
  `start_date` DATETIME(3) NOT NULL,
  -- 0 = Sunday … 6 = Saturday. Per-plan, not per-profile: a coach can run an
  -- academy week and a senior week on different days.
  `week_starts_on` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `season_plans_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- A week is a row rather than something derived from dates, because it carries
-- the coach's own words — the theme and the phase — which nothing can compute.
CREATE TABLE `plan_weeks` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `plan_id` INTEGER NOT NULL,
  `week_index` INTEGER NOT NULL,
  `start_date` DATETIME(3) NOT NULL,
  `theme` VARCHAR(255) NULL,
  `phase` ENUM('pre-season', 'in-season', 'transition') NOT NULL DEFAULT 'in-season',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  -- One row per week number per plan: the guard that stops "Add week" racing
  -- with itself and producing two week 5s.
  UNIQUE INDEX `plan_weeks_plan_id_week_index_key`(`plan_id`, `week_index`),
  INDEX `plan_weeks_plan_id_idx`(`plan_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `training_sessions`
  ADD COLUMN `plan_week_id` INTEGER NULL,
  ADD COLUMN `session_type` ENUM('physical', 'technical', 'tactical', 'match', 'recovery', 'rest') NOT NULL DEFAULT 'tactical',
  -- Perceived intensity 1–10. Load is target_minutes × intensity_rpe and is
  -- DERIVED on read, never stored: a stored total drifts out of step with the
  -- two numbers it came from the moment either is edited.
  ADD COLUMN `intensity_rpe` INTEGER NULL,
  -- "18:00" as text. A time of day in the coach's own timezone — stored as a
  -- DATETIME it would shift when the clocks change.
  ADD COLUMN `start_time` VARCHAR(5) NULL,
  ADD COLUMN `is_match` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `opponent` VARCHAR(120) NULL,
  ADD COLUMN `venue` VARCHAR(120) NULL;

-- Part names in order, e.g. ["Warm-up","Main part","Game","Cool-down"]. Empty
-- means the defaults; blocks carry a matching `part` key inside the existing
-- blocks JSON, so no data migration is needed for the blocks themselves.
--
-- Added nullable, backfilled, then tightened — MySQL will not accept a DEFAULT
-- on a JSON column, so a bare NOT NULL would fail against existing rows. Same
-- three-step as migration 13.
ALTER TABLE `training_sessions` ADD COLUMN `parts` JSON NULL;
UPDATE `training_sessions` SET `parts` = '[]' WHERE `parts` IS NULL;
ALTER TABLE `training_sessions` MODIFY `parts` JSON NOT NULL;

CREATE INDEX `training_sessions_plan_week_id_idx` ON `training_sessions`(`plan_week_id`);
-- The week view asks for "every session in this date range for this coach".
CREATE INDEX `training_sessions_user_id_session_date_idx` ON `training_sessions`(`user_id`, `session_date`);

ALTER TABLE `season_plans` ADD CONSTRAINT `season_plans_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `plan_weeks` ADD CONSTRAINT `plan_weeks_plan_id_fkey`
  FOREIGN KEY (`plan_id`) REFERENCES `season_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting a week must never delete the coach's work.
-- The sessions fall back to being standalone sessions in his library.
ALTER TABLE `training_sessions` ADD CONSTRAINT `training_sessions_plan_week_id_fkey`
  FOREIGN KEY (`plan_week_id`) REFERENCES `plan_weeks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
