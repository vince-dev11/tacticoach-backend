-- Every email the system has tried to send.
--
-- Until now nothing recorded a send. "Did they get the link?" could only be
-- answered by asking the person, and "resend it" had no idea whether there was
-- anything to resend. An admin correcting a typo'd address had no way to see
-- that three mails had already gone to the wrong one.
--
-- Failures and skips are rows too. To someone waiting for a password link,
-- "we tried and the provider refused" and "we never tried because SMTP is not
-- configured" look identical — and they have completely different fixes. Only
-- this table tells them apart.
--
-- Deliberately NOT a queue: it records what happened, it does not drive
-- sending. Nothing reads this table to decide what to do next.

CREATE TABLE `email_log` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  -- The address as it was written at the time. Kept verbatim even if the user
  -- later changes their email: the record is of what went WHERE, when.
  `to`         VARCHAR(255) NOT NULL,
  -- Which template: 'account_setup', 'password_reset', 'player_note'…
  -- A string, not an ENUM. Templates get added often and a migration per
  -- template is a tax nobody pays happily.
  `kind`       VARCHAR(40) NOT NULL,
  `subject`    VARCHAR(255) NOT NULL,
  `status`     ENUM('sent', 'failed', 'skipped') NOT NULL DEFAULT 'sent',
  -- The provider's complaint, trimmed. NULL on success.
  `error`      VARCHAR(500) NULL,
  -- The account it was about, when there is one.
  `user_id`    INT NULL,
  -- The admin who pressed the button, for mails a human triggered.
  `actor_id`   INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `email_log_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `email_log_created_at_idx` (`created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SET NULL on both, never CASCADE: deleting a user must not erase the record
-- that they were emailed, and an admin leaving must not erase what they sent.
-- An audit trail that disappears with the account it concerns is not one.
ALTER TABLE `email_log`
  ADD CONSTRAINT `email_log_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `email_log`
  ADD CONSTRAINT `email_log_actor_id_fkey`
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
