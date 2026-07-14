-- Club brand kit + public page approval lifecycle.

ALTER TABLE `clubs`
  ADD COLUMN `badge_key` VARCHAR(500) NULL,
  ADD COLUMN `primary_color` VARCHAR(9) NULL,
  ADD COLUMN `secondary_color` VARCHAR(9) NULL,
  ADD COLUMN `slug` VARCHAR(80) NULL,
  ADD COLUMN `bio` TEXT NULL,
  ADD COLUMN `page_status` ENUM('none', 'pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'none',
  ADD COLUMN `page_submitted_at` DATETIME(3) NULL,
  ADD COLUMN `page_review_note` VARCHAR(500) NULL;

CREATE UNIQUE INDEX `clubs_slug_key` ON `clubs`(`slug`);
