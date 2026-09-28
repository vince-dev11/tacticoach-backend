-- Fixtures in the season planner: home/away, competition, the result and a
-- short match note. All nullable, so every session saved before stays as it
-- was, and training sessions simply leave them empty.
ALTER TABLE `training_sessions`
    ADD COLUMN `home_away` VARCHAR(4) NULL,
    ADD COLUMN `competition` VARCHAR(80) NULL,
    ADD COLUMN `goals_for` SMALLINT NULL,
    ADD COLUMN `goals_against` SMALLINT NULL,
    ADD COLUMN `match_note` VARCHAR(1000) NULL;
