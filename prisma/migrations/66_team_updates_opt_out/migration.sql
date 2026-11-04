-- BULK-MAIL (4 Nov 2026, owner): Admin → Users → "Email everyone" sends one
-- message to coaches and clubs. Every such email carries a one-click opt-out;
-- this is when the account took it. Null = still receives team updates.
-- Account and service notices are unaffected by it.
ALTER TABLE `users` ADD COLUMN `team_updates_opt_out_at` DATETIME(3) NULL;
