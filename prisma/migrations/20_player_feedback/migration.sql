-- Player feedback: a coach links a player's own account to a roster row, then
-- writes short notes off the back of a session.
--
-- Nothing here grants access. What an account can DO is still resolved by
-- lib/entitlements (subscription + club seat + partner); this only decides who
-- a note is about and who may read it.

-- ---- The roster row gains a link to the player's own account ---------------
ALTER TABLE `squad_players`
  ADD COLUMN `player_user_id` INT NULL,
  -- pending until the PLAYER accepts. A coach knowing an email address must
  -- never be enough to start writing to a child.
  ADD COLUMN `link_status` ENUM('pending', 'active') NULL,
  ADD COLUMN `linked_at` DATETIME(3) NULL,
  ADD COLUMN `guardian_email` VARCHAR(191) NULL,
  -- Removed from the squad but kept because the notes are the PLAYER's record.
  ADD COLUMN `archived_at` DATETIME(3) NULL;

-- Unique per coach, not globally: a player belongs on their club's roster and
-- their school's at the same time.
ALTER TABLE `squad_players`
  ADD UNIQUE INDEX `squad_players_user_id_player_user_id_key` (`user_id`, `player_user_id`),
  ADD INDEX `squad_players_player_user_id_link_status_idx` (`player_user_id`, `link_status`);

ALTER TABLE `squad_players`
  ADD CONSTRAINT `squad_players_player_user_id_fkey`
  FOREIGN KEY (`player_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- The note --------------------------------------------------------------
CREATE TABLE `player_notes` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `squad_player_id` INT NOT NULL,
  `coach_user_id`   INT NOT NULL,
  `session_id`      INT NULL,
  `board_id`        INT NULL,
  `body`            VARCHAR(600) NOT NULL,
  `strengths`       JSON NOT NULL,
  `work_ons`        JSON NOT NULL,
  -- Written, reviewed, then sent as a batch. Nothing reaches a player until
  -- the coach presses send.
  `sent_at`         DATETIME(3) NULL,
  `read_at`         DATETIME(3) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL,

  INDEX `player_notes_squad_player_id_created_at_idx` (`squad_player_id`, `created_at`),
  INDEX `player_notes_session_id_idx` (`session_id`),
  INDEX `player_notes_coach_user_id_idx` (`coach_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `player_notes`
  ADD CONSTRAINT `player_notes_squad_player_id_fkey`
    FOREIGN KEY (`squad_player_id`) REFERENCES `squad_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `player_notes_coach_user_id_fkey`
    FOREIGN KEY (`coach_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `player_notes_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `training_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `player_notes_board_id_fkey`
    FOREIGN KEY (`board_id`) REFERENCES `canvas_boards`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Players can be referred too -------------------------------------------
-- Both tables carry `kind`; the reward ledger's copy is half of the idempotency
-- key that stops a ladder rung paying out twice, so it has to learn the value
-- as well.
ALTER TABLE `referrals`
  MODIFY COLUMN `kind` ENUM('coach', 'club', 'player') NOT NULL DEFAULT 'coach';

ALTER TABLE `referral_rewards`
  MODIFY COLUMN `kind` ENUM('coach', 'club', 'player') NOT NULL DEFAULT 'coach';
