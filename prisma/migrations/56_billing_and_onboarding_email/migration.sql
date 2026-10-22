-- BILLING + ONBOARDING-EMAIL (20 Oct 2026)
--
-- 1. The coach's language, so emails reach them in it. On users and on leads
--    (an early-access request carries it into the account the team creates).
-- 2. Setup-link reminders: when the invitation went out, how many reminders
--    followed, and when the team sent the personal "show you round" message.
-- 3. Bounces: the provider's id for each email, so a bounce webhook can mark
--    the right row failed.
-- 4. Stripe webhook events already handled, so a re-delivered event is a no-op.

ALTER TABLE `users` ADD COLUMN `locale` VARCHAR(8) NULL;
ALTER TABLE `users` ADD COLUMN `setup_invited_at` DATETIME(3) NULL;
ALTER TABLE `users` ADD COLUMN `setup_reminders_sent` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `welcomed_at` DATETIME(3) NULL;
CREATE INDEX `users_setup_invited_at_idx` ON `users`(`setup_invited_at`);

ALTER TABLE `contact_messages` ADD COLUMN `locale` VARCHAR(8) NULL;

ALTER TABLE `email_log` ADD COLUMN `provider_message_id` VARCHAR(255) NULL;
CREATE INDEX `email_log_provider_message_id_idx` ON `email_log`(`provider_message_id`);

CREATE TABLE `stripe_events` (
    `id` VARCHAR(255) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Invitations already out: an unverified account that was sent a set-password
-- link is an invitation. Its clock starts at the first such email, and the
-- reminders it never got are not owed retroactively (counted as sent).
UPDATE `users` u
JOIN (
  SELECT `user_id`, MIN(`created_at`) AS first_sent
  FROM `email_log`
  WHERE `kind` = 'account_setup' AND `user_id` IS NOT NULL
  GROUP BY `user_id`
) s ON s.`user_id` = u.`id`
SET u.`setup_invited_at` = s.first_sent,
    u.`setup_reminders_sent` = 2
WHERE u.`email_verified_at` IS NULL;
