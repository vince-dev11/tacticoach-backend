-- Session Builder: a full training session composed of ordered blocks that
-- REFERENCE library items (boards, drill sheets) or hold plain text, each with
-- minutes. `brand` carries the coach's PDF customisation for this session.
CREATE TABLE `training_sessions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `session_date` DATETIME(3) NULL,
  `age_group` VARCHAR(16) NULL,
  `target_minutes` INTEGER NULL,
  `blocks` JSON NOT NULL,
  `brand` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `training_sessions_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `training_sessions`
  ADD CONSTRAINT `training_sessions_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
