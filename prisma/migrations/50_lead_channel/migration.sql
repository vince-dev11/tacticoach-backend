-- Where a lead heard about us (6 Oct 2026): Facebook, Instagram, a club
-- event… Separate from `source`, which is how the row got INTO the table
-- (contact form / typed in / spreadsheet). A string, not an enum, so a new
-- channel is a code change, not a migration; the API validates the list
-- (modules/admin/lead-channels.ts). NULL = not known yet.
ALTER TABLE `contact_messages` ADD COLUMN `channel` VARCHAR(20) NULL;
CREATE INDEX `contact_messages_channel_idx` ON `contact_messages`(`channel`);
