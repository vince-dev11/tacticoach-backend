-- SAME-INBOX (25 Nov 2026, owner): the inbox each email really delivers to —
-- lower case, no "+tag", and for Gmail no dots (googlemail.com = gmail.com).
-- New sign-ups for an inbox that already has an account are refused.
-- Existing accounts are filled in below and never changed or refused.
ALTER TABLE `users` ADD COLUMN `email_inbox` VARCHAR(191) NULL;

UPDATE `users`
SET `email_inbox` = CASE
  WHEN LOWER(SUBSTRING_INDEX(`email`, '@', -1)) IN ('gmail.com', 'googlemail.com')
    THEN CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1), '.', ''), '@gmail.com')
  ELSE CONCAT(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1), '@', LOWER(SUBSTRING_INDEX(`email`, '@', -1)))
END
WHERE `email` LIKE '%@%';

CREATE INDEX `users_email_inbox_idx` ON `users`(`email_inbox`);
