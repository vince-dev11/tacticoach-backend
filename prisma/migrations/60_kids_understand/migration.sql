-- KIDS (26 Oct 2026): helping children understand — brief
-- tacticoach-frontend/docs/briefs/2026-10-26-kids-understand.md.
--
-- 1. Before-the-session preview for parents: a private link the coach shares
--    (and can switch off — the token goes back to NULL), plus the one question
--    parents ask their child on the way to training. Additive and nullable.
ALTER TABLE `training_sessions` ADD COLUMN `preview_token` VARCHAR(32) NULL;
ALTER TABLE `training_sessions` ADD COLUMN `preview_question` VARCHAR(200) NULL;
CREATE UNIQUE INDEX `training_sessions_preview_token_key` ON `training_sessions`(`preview_token`);

-- 2. A small home challenge sent with a player's feedback ("10 minutes, three
--    times this week: …"). Shown to the player, on the parent's Family page
--    and in the parent copy.
ALTER TABLE `player_notes` ADD COLUMN `challenge` VARCHAR(200) NULL;
