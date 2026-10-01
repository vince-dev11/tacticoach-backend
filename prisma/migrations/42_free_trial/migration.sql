-- 42_free_trial: Free becomes a 14-day limited trial (decided 1 Oct 2026).
--
-- free_trial_ends_at lives on the user because the free tier has no
-- subscription row (FREE_PLAN is synthetic). Existing accounts get a fresh
-- 14 days from the moment this runs, as decided; players are left NULL —
-- they are never on a trial.
ALTER TABLE `users`
  ADD COLUMN `free_trial_ends_at` DATETIME(3) NULL,
  ADD COLUMN `free_trial_reminder_sent_at` DATETIME(3) NULL;

UPDATE `users` SET `free_trial_ends_at` = DATE_ADD(NOW(3), INTERVAL 14 DAY)
  WHERE `account_type` <> 'player';

-- Lifetime creations on the free trial. Deleting never decrements these:
-- "3 boards" means three boards made, not three kept.
CREATE TABLE `free_usage` (
  `user_id` INTEGER NOT NULL,
  `boards` INTEGER NOT NULL DEFAULT 0,
  `drill_sheets` INTEGER NOT NULL DEFAULT 0,
  `sessions` INTEGER NOT NULL DEFAULT 0,
  `seasons` INTEGER NOT NULL DEFAULT 0,
  `books` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `free_usage_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- What each coach already has counts toward the new limits.
INSERT INTO `free_usage` (`user_id`, `boards`, `drill_sheets`, `sessions`, `seasons`, `books`)
SELECT u.`id`,
  (SELECT COUNT(*) FROM `canvas_boards` b WHERE b.`user_id` = u.`id`),
  (SELECT COUNT(*) FROM `drill_sheets` d WHERE d.`user_id` = u.`id`),
  (SELECT COUNT(*) FROM `training_sessions` s WHERE s.`user_id` = u.`id` AND s.`is_match` = false),
  (SELECT COUNT(*) FROM `season_plans` p WHERE p.`user_id` = u.`id`),
  (SELECT COUNT(*) FROM `ebooks` e WHERE e.`author_id` = u.`id`)
FROM `users` u WHERE u.`account_type` <> 'player';
