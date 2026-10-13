-- FAMILY (12 Oct 2026): coach-created players with parent accounts.
--
-- Only coaches create player accounts now. The coach enters the date of
-- birth; under 18 needs a parent, who must accept (consent) before the child
-- can log in; under 13 has no login at all (seen through the parent).
ALTER TABLE `users` MODIFY `account_type` ENUM('coach', 'club', 'player', 'parent') NOT NULL DEFAULT 'coach';
ALTER TABLE `users` ADD COLUMN `date_of_birth` DATE NULL;
ALTER TABLE `users` ADD COLUMN `can_login` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `parent_links` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `parent_user_id` INTEGER NOT NULL,
  `child_user_id` INTEGER NOT NULL,
  `status` ENUM('pending', 'active') NOT NULL DEFAULT 'pending',
  `consent_at` DATETIME(3) NULL,
  `invited_by_id` INTEGER NULL,
  `invite_token_hash` VARCHAR(64) NULL,
  `invite_expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `parent_links_invite_token_hash_key`(`invite_token_hash`),
  UNIQUE INDEX `parent_links_parent_user_id_child_user_id_key`(`parent_user_id`, `child_user_id`),
  INDEX `parent_links_child_user_id_status_idx`(`child_user_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `parent_links` ADD CONSTRAINT `parent_links_parent_user_id_fkey` FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `parent_links` ADD CONSTRAINT `parent_links_child_user_id_fkey` FOREIGN KEY (`child_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- "Ask your parent" for a paid book.
CREATE TABLE `book_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `child_user_id` INTEGER NOT NULL,
  `ebook_id` INTEGER NOT NULL,
  `status` ENUM('pending', 'done', 'dismissed') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `book_requests_child_user_id_ebook_id_key`(`child_user_id`, `ebook_id`),
  INDEX `book_requests_ebook_id_idx`(`ebook_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `book_requests` ADD CONSTRAINT `book_requests_child_user_id_fkey` FOREIGN KEY (`child_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `book_requests` ADD CONSTRAINT `book_requests_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- BOOK-RECOMMEND: a coach recommends a book to a player they coach.
CREATE TABLE `book_recommendations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `coach_id` INTEGER NOT NULL,
  `player_user_id` INTEGER NOT NULL,
  `ebook_id` INTEGER NOT NULL,
  `note` VARCHAR(200) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `book_recommendations_coach_id_player_user_id_ebook_id_key`(`coach_id`, `player_user_id`, `ebook_id`),
  INDEX `book_recommendations_player_user_id_idx`(`player_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `book_recommendations` ADD CONSTRAINT `book_recommendations_coach_id_fkey` FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `book_recommendations` ADD CONSTRAINT `book_recommendations_player_user_id_fkey` FOREIGN KEY (`player_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `book_recommendations` ADD CONSTRAINT `book_recommendations_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- BOOK-AGES: the youngest players.
ALTER TABLE `ebooks` MODIFY `age_band` ENUM('u5_8', 'u9_11', 'u12_14', 'u15_18', 'adult', 'all') NOT NULL DEFAULT 'all';
-- BOOK-PAGE: "What you'll learn".
ALTER TABLE `ebooks` ADD COLUMN `outcomes` JSON NULL;
