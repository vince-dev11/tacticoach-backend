-- Coach corrections: the difference between what the AI drew and what the
-- coach actually saved. A regenerate click says "something was off"; a moved
-- centre-back says what. Each row is a compact structured diff plus a few
-- denormalised aggregates so "what do coaches keep fixing?" is a GROUP BY,
-- not a JSON parse.
CREATE TABLE `ai_corrections` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `source` VARCHAR(12) NOT NULL,
  `concept` VARCHAR(40) NOT NULL,
  `quality` INTEGER NOT NULL,
  `prompt_hash` VARCHAR(16) NULL,
  `context` VARCHAR(40) NULL,
  `diff` JSON NOT NULL,
  `moved_count` INTEGER NOT NULL,
  `added_count` INTEGER NOT NULL,
  `removed_count` INTEGER NOT NULL,
  `mean_shift` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ai_corrections_concept_created_at_idx` (`concept`, `created_at`),
  INDEX `ai_corrections_source_created_at_idx` (`source`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_corrections`
  ADD CONSTRAINT `ai_corrections_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
