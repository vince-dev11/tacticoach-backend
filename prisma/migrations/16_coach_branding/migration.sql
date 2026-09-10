-- Coach branding: a public page per coach (/coach/:slug), the solo-coach
-- counterpart of club branding. Photo/colour/bio/title make up the brand kit.
ALTER TABLE `users` ADD COLUMN `coach_slug` VARCHAR(60) NULL;
ALTER TABLE `users` ADD COLUMN `coach_photo_key` VARCHAR(500) NULL;
ALTER TABLE `users` ADD COLUMN `coach_color` VARCHAR(9) NULL;
ALTER TABLE `users` ADD COLUMN `coach_bio` TEXT NULL;
ALTER TABLE `users` ADD COLUMN `coach_title` VARCHAR(80) NULL;
ALTER TABLE `users` ADD COLUMN `coach_page_enabled` BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX `users_coach_slug_key` ON `users`(`coach_slug`);
