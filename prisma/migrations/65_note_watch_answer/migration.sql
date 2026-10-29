-- NOTE-BOARD / PLAYER-ANSWER (29 Oct 2026, owner): the move a coach sends with
-- a note can be watched privately by that player (or their parent) and
-- answered with a tap or a placed run — never free text. Three nullable
-- columns; nothing else is recorded about a child.
ALTER TABLE `player_notes`
  ADD COLUMN `watched_at` DATETIME(3) NULL,
  ADD COLUMN `answer` JSON NULL,
  ADD COLUMN `answered_at` DATETIME(3) NULL;
