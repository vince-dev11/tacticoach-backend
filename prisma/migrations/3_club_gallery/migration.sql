-- Club intro fields + public-page gallery.

ALTER TABLE `clubs`
  ADD COLUMN `location` VARCHAR(150) NULL,
  ADD COLUMN `founded_year` INTEGER NULL;

CREATE TABLE `club_photos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `club_id` INTEGER NOT NULL,
    `image_key` VARCHAR(500) NOT NULL,
    `caption` VARCHAR(200) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `club_photos_club_id_sort_order_idx`(`club_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `club_photos` ADD CONSTRAINT `club_photos_club_id_fkey` FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
