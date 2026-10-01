-- 44_plan_day_notes: a title and a description per DAY of a season week
-- (coach feedback, 1 Oct 2026: "we need day-wise title and description" —
-- "Recovery — light work", "MD-1: set pieces"). Keyed by ISO date:
-- { "2026-09-28": { "title": "...", "description": "..." } }. Nullable.
ALTER TABLE `plan_weeks` ADD COLUMN `day_notes` JSON NULL;
