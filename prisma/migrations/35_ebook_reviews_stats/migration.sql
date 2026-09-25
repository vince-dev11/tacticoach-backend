-- Ebook reviews and the author dashboard's daily counters.

CREATE TABLE `ebook_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ebook_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `rating` TINYINT NOT NULL,
    `body` VARCHAR(1000) NULL,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `author_reply` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ebook_reviews_ebook_id_user_id_key`(`ebook_id`, `user_id`),
    INDEX `ebook_reviews_ebook_id_hidden_created_at_idx`(`ebook_id`, `hidden`, `created_at`),
    INDEX `ebook_reviews_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ebook_daily_stats` (
    `ebook_id` INTEGER NOT NULL,
    `day` DATE NOT NULL,
    `page_views` INTEGER NOT NULL DEFAULT 0,
    `sample_reads` INTEGER NOT NULL DEFAULT 0,
    `chapter_reads` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`ebook_id`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_reviews` ADD CONSTRAINT `ebook_reviews_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_reviews` ADD CONSTRAINT `ebook_reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_daily_stats` ADD CONSTRAINT `ebook_daily_stats_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
