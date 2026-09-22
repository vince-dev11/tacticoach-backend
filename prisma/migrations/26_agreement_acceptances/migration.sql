-- Who signed which agreement, when, and from where.
--
-- A TABLE rather than columns on `users`, for one reason that matters: a
-- signature is a historical fact, not a current state. When the terms change
-- and somebody accepts v1.1, the record that they accepted v1.0 in September
-- must not be overwritten — that record IS the evidence of what they agreed to
-- while it applied. Columns would keep only the latest and quietly destroy the
-- rest.
--
-- The collaboration agreement still records its acceptance on `collaborators` (one row,
-- latest only). That is not changed here: it already has signed-at, version
-- and IP, and moving live commercial records is not something to bundle into
-- a feature. New agreements land here; the collaboration one can be migrated across
-- later if we ever need its history.

CREATE TABLE `agreement_acceptances` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `user_id`   INT NOT NULL,
  -- Which agreement. An ENUM rather than free text: an acceptance filed under
  -- a typo'd kind is an acceptance nobody can find.
  `kind`      ENUM('referral', 'collaboration') NOT NULL,
  -- The version string as it was at acceptance ('1.0'). With the text kept in
  -- code and never edited in place, this is enough to reproduce exactly what
  -- they were shown.
  `version`   VARCHAR(16) NOT NULL,
  `signed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Best-effort. Behind a proxy this is whatever Fastify resolved, and it is
  -- evidence of circumstance rather than identity — nullable because a missing
  -- IP must never be a reason to refuse somebody's acceptance.
  `ip`        VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  -- Re-posting the same acceptance is idempotent rather than a second row.
  -- Double-clicking "I accept" is not two agreements.
  UNIQUE KEY `agreement_acceptances_user_kind_version_key` (`user_id`, `kind`, `version`),
  INDEX `agreement_acceptances_user_kind_idx` (`user_id`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CASCADE, unlike the email log: an email log is a record of what WE did and
-- survives the account, whereas an agreement with a deleted person is not a
-- contract with anyone. Deleting the account ends the agreement.
ALTER TABLE `agreement_acceptances`
  ADD CONSTRAINT `agreement_acceptances_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
