-- CRM-PIPELINE (28 Oct 2026, owner): sales stages, follow-up dates, deal value
-- and a timeline on leads. Columns are added with defaults; existing leads
-- start at stage `new` (replied ones are moved to `contacted` below).
ALTER TABLE `contact_messages`
  ADD COLUMN `stage` ENUM('new', 'contacted', 'demo', 'trial', 'won', 'lost') NOT NULL DEFAULT 'new',
  ADD COLUMN `stage_changed_at` DATETIME(3) NULL,
  ADD COLUMN `follow_up_at` DATETIME(3) NULL,
  ADD COLUMN `deal_value_pence` INTEGER NULL,
  ADD COLUMN `lost_reason` VARCHAR(160) NULL;

CREATE INDEX `contact_messages_stage_idx` ON `contact_messages`(`stage`);
CREATE INDEX `contact_messages_follow_up_at_idx` ON `contact_messages`(`follow_up_at`);

-- A lead we have already answered has been contacted.
UPDATE `contact_messages` SET `stage` = 'contacted' WHERE `status` = 'replied';

CREATE TABLE `lead_activities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `lead_id` INTEGER NOT NULL,
  `kind` ENUM('note', 'stage', 'followup', 'reply') NOT NULL,
  `text` VARCHAR(1000) NOT NULL,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `lead_activities_lead_id_created_at_idx`(`lead_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `contact_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
