-- Buying books.
--
-- One row per reader per book: that row IS ownership. A pending checkout is
-- the same row before payment, so a reader who starts twice never owns a book
-- twice, and a refund switches the one row off.
--
-- Money is pence, never a float. The split is written on the row when it is
-- paid (70% to the author side, 30% to us today), so changing the split later
-- never restates a sale already made.
--
-- The payment gateway is not connected yet: `provider` is 'test' for owner
-- test purchases and NULL for grants. Stripe or Paddle fill it in later, with
-- their checkout id in `provider_ref`.
CREATE TABLE `ebook_purchases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ebook_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `status` ENUM('pending', 'paid', 'refunded') NOT NULL DEFAULT 'pending',
  `source` ENUM('checkout', 'grant') NOT NULL DEFAULT 'checkout',
  `price_pence` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
  `author_share_percent` TINYINT NOT NULL DEFAULT 70,
  `author_share_pence` INTEGER NOT NULL DEFAULT 0,
  `platform_share_pence` INTEGER NOT NULL DEFAULT 0,
  `provider` VARCHAR(20) NULL,
  `provider_ref` VARCHAR(255) NULL,
  `consent_at` DATETIME(3) NULL,
  `paid_at` DATETIME(3) NULL,
  `refunded_at` DATETIME(3) NULL,
  `granted_by_id` INTEGER NULL,
  `note` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ebook_purchases_ebook_id_user_id_key`(`ebook_id`, `user_id`),
  UNIQUE INDEX `ebook_purchases_provider_ref_key`(`provider_ref`),
  INDEX `ebook_purchases_user_id_status_idx`(`user_id`, `status`),
  INDEX `ebook_purchases_status_paid_at_idx`(`status`, `paid_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_purchases` ADD CONSTRAINT `ebook_purchases_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ebook_purchases` ADD CONSTRAINT `ebook_purchases_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- "Tell me when I can buy this" — until the gateway is live.
CREATE TABLE `ebook_waitlist` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ebook_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notified_at` DATETIME(3) NULL,

  UNIQUE INDEX `ebook_waitlist_ebook_id_user_id_key`(`ebook_id`, `user_id`),
  INDEX `ebook_waitlist_notified_at_idx`(`notified_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_waitlist` ADD CONSTRAINT `ebook_waitlist_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_waitlist` ADD CONSTRAINT `ebook_waitlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
