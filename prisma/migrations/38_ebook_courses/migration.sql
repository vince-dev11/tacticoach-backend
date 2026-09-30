-- Books as courses, certificates, series, co-authors and club books.
--
-- Additive only. Every existing book stays an ordinary shop book: not a
-- course, in no series, no co-authors, no club. The one data change is giving
-- each existing chapter a stable key (course progress hangs off it, because
-- saving a book rewrites its chapter ids).

-- ---- ebooks: course mode, series, club ------------------------------------
ALTER TABLE `ebooks`
    ADD COLUMN `is_course` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pass_percent` TINYINT NOT NULL DEFAULT 80,
    ADD COLUMN `study_minutes` SMALLINT NULL,
    ADD COLUMN `series_id` INTEGER NULL,
    ADD COLUMN `series_order` INTEGER NULL,
    ADD COLUMN `club_id` INTEGER NULL,
    ADD COLUMN `club_audience` ENUM('coaches', 'players', 'everyone') NULL;

CREATE INDEX `ebooks_series_id_series_order_idx` ON `ebooks`(`series_id`, `series_order`);
CREATE INDEX `ebooks_club_id_status_idx` ON `ebooks`(`club_id`, `status`);

-- ---- chapters: a key that survives saves ----------------------------------
ALTER TABLE `ebook_chapters` ADD COLUMN `chapter_key` VARCHAR(24) NOT NULL DEFAULT '';
UPDATE `ebook_chapters` SET `chapter_key` = SUBSTRING(MD5(CONCAT(`id`, '-', RAND())), 1, 12) WHERE `chapter_key` = '';

-- ---- series ---------------------------------------------------------------
CREATE TABLE `ebook_series` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_id` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `ebook_series_owner_id_idx`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---- co-authors -----------------------------------------------------------
CREATE TABLE `ebook_coauthors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ebook_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `email` VARCHAR(255) NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `share_percent` TINYINT NOT NULL DEFAULT 0,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ebook_coauthors_token_key`(`token`),
    UNIQUE INDEX `ebook_coauthors_ebook_id_email_key`(`ebook_id`, `email`),
    INDEX `ebook_coauthors_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---- course progress ------------------------------------------------------
CREATE TABLE `ebook_quiz_answers` (
    `user_id` INTEGER NOT NULL,
    `ebook_id` INTEGER NOT NULL,
    `question_id` VARCHAR(24) NOT NULL,
    `chapter_key` VARCHAR(24) NOT NULL,
    `choice` TINYINT NOT NULL,
    `correct` BOOLEAN NOT NULL,
    `attempts` TINYINT NOT NULL DEFAULT 1,
    `answered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`user_id`, `ebook_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ebook_chapter_reads` (
    `user_id` INTEGER NOT NULL,
    `ebook_id` INTEGER NOT NULL,
    `chapter_key` VARCHAR(24) NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`user_id`, `ebook_id`, `chapter_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---- certificates ---------------------------------------------------------
CREATE TABLE `ebook_certificates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(16) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `ebook_id` INTEGER NOT NULL,
    `holder_name` VARCHAR(160) NOT NULL,
    `course_title` VARCHAR(160) NOT NULL,
    `course_sub` VARCHAR(200) NULL,
    `authors` JSON NOT NULL,
    `chapters` SMALLINT NOT NULL,
    `correct` SMALLINT NOT NULL,
    `total` SMALLINT NOT NULL,
    `percent` TINYINT NOT NULL,
    `study_minutes` SMALLINT NULL,
    `topics` JSON NOT NULL,
    `club_name` VARCHAR(150) NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(300) NULL,
    UNIQUE INDEX `ebook_certificates_code_key`(`code`),
    UNIQUE INDEX `ebook_certificates_user_id_ebook_id_key`(`user_id`, `ebook_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---- foreign keys ---------------------------------------------------------
ALTER TABLE `ebooks` ADD CONSTRAINT `ebooks_series_id_fkey` FOREIGN KEY (`series_id`) REFERENCES `ebook_series`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ebooks` ADD CONSTRAINT `ebooks_club_id_fkey` FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_series` ADD CONSTRAINT `ebook_series_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_coauthors` ADD CONSTRAINT `ebook_coauthors_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_coauthors` ADD CONSTRAINT `ebook_coauthors_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_quiz_answers` ADD CONSTRAINT `ebook_quiz_answers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_quiz_answers` ADD CONSTRAINT `ebook_quiz_answers_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_chapter_reads` ADD CONSTRAINT `ebook_chapter_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_chapter_reads` ADD CONSTRAINT `ebook_chapter_reads_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_certificates` ADD CONSTRAINT `ebook_certificates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_certificates` ADD CONSTRAINT `ebook_certificates_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
