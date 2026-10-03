-- The public coach page (/coach/:slug) becomes OPT-IN (3 Oct 2026, owner's
-- decision). It defaulted to on, and the Profile form pre-filled a page
-- address from the coach's name, so saving their colours or badge was enough
-- to put a page with their name and photo on the open web once they had
-- published one board. No coach ever chose that, so every page goes off
-- here; a coach who wants one switches "Show my public page" on again.
-- Nothing a coach wrote is deleted: address, photo, bio and colour stay.
ALTER TABLE `users` ALTER COLUMN `coach_page_enabled` SET DEFAULT false;
UPDATE `users` SET `coach_page_enabled` = false;
