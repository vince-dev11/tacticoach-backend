-- SEASON-DAYS (27 Oct 2026, product review): the days a team trains or plays
-- ("2,4,6" — 0 = Sunday … 6 = Saturday). The season screen shows only those
-- days (and any day with something on it); NULL = every day, as before.
ALTER TABLE `season_plans` ADD COLUMN `team_days` VARCHAR(20) NULL;
