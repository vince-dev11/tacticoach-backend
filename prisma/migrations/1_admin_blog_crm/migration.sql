-- Owner role, blog posts and CRM leads.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `role` ENUM('user', 'owner') NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE `blog_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(200) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `excerpt` TEXT NULL,
    `content` LONGTEXT NOT NULL,
    `cover_image_key` VARCHAR(500) NULL,
    `tags` JSON NOT NULL,
    `status` ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
    `published_at` DATETIME(3) NULL,
    `author_id` INTEGER NOT NULL,
    `seo_title` VARCHAR(255) NULL,
    `seo_description` VARCHAR(320) NULL,
    `read_minutes` INTEGER NOT NULL DEFAULT 3,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `blog_posts_slug_key`(`slug`),
    INDEX `blog_posts_status_published_at_idx`(`status`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `message` TEXT NOT NULL,
    `status` ENUM('new', 'replied', 'closed') NOT NULL DEFAULT 'new',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contact_messages_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
