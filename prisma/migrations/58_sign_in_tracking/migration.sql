-- SIGN-IN (23 Oct 2026): has this person ever signed in, and did an invited
-- person set their password from the link they were sent?
--
-- Admin → Users shows both. Sign-ins were never recorded before, so existing
-- accounts are filled in from EVIDENCE, never guessed:
--   * first_login_at: the earliest of their live sign-in sessions (refresh
--     tokens), boards, drill sheets and session plans — you cannot make any
--     of those without having signed in. No evidence = left empty.
--   * last_login_at: left empty — there is no honest way to know it.
--   * setup_completed_at: for INVITED accounts that are verified. An invited
--     account only becomes verified by opening a link we emailed (the
--     set-password link sets it), so that date is when they did it.

ALTER TABLE `users` ADD COLUMN `first_login_at` DATETIME(3) NULL;
ALTER TABLE `users` ADD COLUMN `last_login_at` DATETIME(3) NULL;
ALTER TABLE `users` ADD COLUMN `setup_completed_at` DATETIME(3) NULL;
CREATE INDEX `users_first_login_at_idx` ON `users`(`first_login_at`);

UPDATE `users` u
JOIN (
  SELECT `user_id`, MIN(`at`) AS `first_at` FROM (
    SELECT `user_id`, `created_at` AS `at` FROM `refresh_tokens`
    UNION ALL SELECT `user_id`, `created_at` FROM `canvas_boards`
    UNION ALL SELECT `user_id`, `created_at` FROM `drill_sheets`
    UNION ALL SELECT `user_id`, `created_at` FROM `training_sessions`
  ) AS `evidence`
  GROUP BY `user_id`
) e ON e.`user_id` = u.`id`
SET u.`first_login_at` = e.`first_at`
WHERE u.`first_login_at` IS NULL;

UPDATE `users`
SET `setup_completed_at` = `email_verified_at`
WHERE `setup_invited_at` IS NOT NULL AND `email_verified_at` IS NOT NULL AND `setup_completed_at` IS NULL;
