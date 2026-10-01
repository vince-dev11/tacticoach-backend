-- "Got it, coach": the one reply a player can give to a feedback note.
-- A timestamp, never text. Null until the player taps it.
ALTER TABLE `player_notes` ADD COLUMN `acknowledged_at` DATETIME(3) NULL;
