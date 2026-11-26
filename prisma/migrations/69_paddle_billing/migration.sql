-- PADDLE (25 Nov 2026, owner: "build Paddle now"): plans and books through
-- Paddle (merchant of record), and the author royalty ledger — TactiCoach is
-- paid 100% and pays authors their 70% from its bank every month.

ALTER TABLE `users` ADD COLUMN `paddle_customer_id` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `users_paddle_customer_id_key` ON `users`(`paddle_customer_id`);

CREATE TABLE `paddle_events` (
  `id` VARCHAR(64) NOT NULL,
  `type` VARCHAR(100) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `paddle_catalog` (
  `key` VARCHAR(120) NOT NULL,
  `paddle_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `paddle_catalog_paddle_id_key`(`paddle_id`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `author_payouts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NULL,
  `payee_name` VARCHAR(150) NOT NULL,
  `amount_pence` INT NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
  `paid_at` DATETIME(3) NOT NULL,
  `reference` VARCHAR(120) NOT NULL,
  `note` VARCHAR(255) NULL,
  `created_by_id` INT NOT NULL,
  `voided_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `author_payouts_user_id_paid_at_idx`(`user_id`, `paid_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `author_payouts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `author_payees` (
  `user_id` INT NOT NULL,
  `legal_name` VARCHAR(150) NOT NULL,
  `country` VARCHAR(2) NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank',
  `tax_form_received` BOOLEAN NOT NULL DEFAULT false,
  `note` VARCHAR(255) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `author_payees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
