-- Multiple squads per coach.
--
-- A coach with two age groups had one merged list of players. The feedback
-- drawer offered every child they know for a session twenty of them were not
-- at, and the editor's player shelf mixed U13s with U15s. This gives each team
-- its own roster and lets a session say which team it was for.
--
-- THE RULE THIS MIGRATION PRESERVES: one coach, one player, one row.
-- `squad_players` keeps its UNIQUE(user_id, player_user_id). A second row for
-- the same child under the same coach would split their note history in two,
-- so a player moving up from the U13s to the U15s mid-season would lose their
-- record. Moving squads moves the row; the notes follow it.
--
-- Nothing is destroyed here and nothing requires a coach to act: every
-- existing player is back-filled into one squad per coach, and every existing
-- session keeps `squad_id` NULL, which resolves to that default squad.

-- ---- The team ---------------------------------------------------------------
CREATE TABLE `squads` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `user_id`     INT NOT NULL,
  `name`        VARCHAR(60) NOT NULL,
  -- A label only. The SESSION's own age_group still drives playing format.
  `age_group`   VARCHAR(16) NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  -- Retired rather than deleted: sessions and notes reference it, and a coach
  -- who stops taking the U13s still has last season's feedback.
  `archived_at` DATETIME(3) NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `squads_user_id_sort_order_idx` (`user_id`, `sort_order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `squads`
  ADD CONSTRAINT `squads_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Which team a player belongs to -----------------------------------------
ALTER TABLE `squad_players`
  ADD COLUMN `squad_id` INT NULL,
  ADD INDEX `squad_players_squad_id_sort_order_idx` (`squad_id`, `sort_order`);

-- ---- Which team a session was for -------------------------------------------
-- NULL = the coach's default squad. Left NULL for every existing session
-- rather than guessed at: a session's age_group is a label the coach typed and
-- matching on it would silently file sessions under the wrong team.
ALTER TABLE `training_sessions`
  ADD COLUMN `squad_id` INT NULL,
  ADD INDEX `training_sessions_squad_id_idx` (`squad_id`);

-- ---- Back-fill --------------------------------------------------------------
-- One squad per coach who actually has players. Named from the coach's own
-- age group when they set one ("U13"), otherwise "My squad" — the heading that
-- has been above this list all along, so nothing looks renamed.
--
-- Archived players are included deliberately: their rows carry note history,
-- and a row with no squad would be invisible to every squad-scoped query.
INSERT INTO `squads` (`user_id`, `name`, `age_group`, `sort_order`)
SELECT
  u.`id`,
  COALESCE(NULLIF(TRIM(u.`coach_age_group`), ''), 'My squad'),
  NULLIF(TRIM(u.`coach_age_group`), ''),
  0
FROM `users` u
WHERE EXISTS (SELECT 1 FROM `squad_players` p WHERE p.`user_id` = u.`id`);

UPDATE `squad_players` p
JOIN `squads` s ON s.`user_id` = p.`user_id`
SET p.`squad_id` = s.`id`
WHERE p.`squad_id` IS NULL;

ALTER TABLE `squad_players`
  ADD CONSTRAINT `squad_players_squad_id_fkey`
  FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: archiving a team must never delete the sessions the
-- coach ran with it. They fall back to the default squad.
ALTER TABLE `training_sessions`
  ADD CONSTRAINT `training_sessions_squad_id_fkey`
  FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
