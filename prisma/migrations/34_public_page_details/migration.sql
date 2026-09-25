-- Public-page details for coaches and clubs. All nullable / defaulted so
-- existing rows and pages are unchanged.

ALTER TABLE `users`
  ADD COLUMN `coaching_since` INTEGER NULL,
  ADD COLUMN `coach_qualifications` VARCHAR(160) NULL,
  ADD COLUMN `coach_philosophy` VARCHAR(200) NULL,
  ADD COLUMN `coach_location` VARCHAR(120) NULL,
  ADD COLUMN `coach_contact_enabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `clubs`
  ADD COLUMN `website_url` VARCHAR(300) NULL,
  ADD COLUMN `age_groups` VARCHAR(120) NULL;
