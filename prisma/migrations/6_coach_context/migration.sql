-- Coach context: who the sessions are actually for.
--
-- Until now the AI received only the coach's sentence and the board size, so it
-- could not tell an under-9 session from a senior one. Age fixes the playing
-- format, the format caps the squad, and both decide which concepts are even
-- appropriate — a sustained high press is not a stylistic choice at under-9,
-- it is the wrong football.
--
-- All three are nullable: an existing coach who has set nothing keeps working,
-- and generation falls back to senior 11-a-side exactly as it does today.
ALTER TABLE `users`
  ADD COLUMN `coach_age_group` VARCHAR(16) NULL,
  ADD COLUMN `coach_format` VARCHAR(16) NULL,
  ADD COLUMN `coach_level` VARCHAR(24) NULL;
