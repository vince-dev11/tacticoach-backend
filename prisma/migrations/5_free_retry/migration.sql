-- Free retry: one re-run of the same prompt within the window costs nothing.
-- `prompt_hash` is a fingerprint (never the prompt itself) so we can match a
-- retry to its original; `free_retry` marks rows that must NOT consume the
-- monthly allowance while still being counted for accuracy telemetry.
ALTER TABLE `ai_usage`
  ADD COLUMN `prompt_hash` VARCHAR(16) NULL,
  ADD COLUMN `free_retry` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `ai_usage_user_id_prompt_hash_created_at_idx`
  ON `ai_usage` (`user_id`, `prompt_hash`, `created_at`);
