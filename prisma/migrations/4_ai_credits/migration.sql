-- AI credit system: monthly allowance is derived from the plan and enforced by
-- counting ai_usage rows in the current calendar month; bonus_credits holds
-- purchased top-ups (never expire).

ALTER TABLE `users` ADD COLUMN `bonus_credits` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `ai_usage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `kind` ENUM('layout', 'animation', 'reel') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_usage` ADD CONSTRAINT `ai_usage_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
