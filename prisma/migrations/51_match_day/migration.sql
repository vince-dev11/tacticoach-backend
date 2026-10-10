-- Match-day mode (9 Oct 2026): a fixture's line-up, bench, substitutions,
-- minutes and half-time board, as one JSON document on the match itself.
-- NULL until the coach opens Match day. Minutes are derived from the stints
-- in it, never stored as totals.
ALTER TABLE `training_sessions` ADD COLUMN `match_day` JSON NULL;
