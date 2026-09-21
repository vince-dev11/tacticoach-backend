-- Video exports, counted.
--
-- Basic includes animation and video — deliberately, because it is why coaches
-- try the product — but capped per month, because encoding and storing video
-- is the one feature with a real marginal cost.
--
-- A row per export rather than a counter on the user, for two reasons:
--   1. A counter has to be reset, and "reset monthly" means either a cron job
--      that can fail silently or a stored period that has to be compared
--      anyway. Counting rows in a window needs neither.
--   2. When the cap is wrong — and the number 10 is a guess until real usage
--      says otherwise — this is the data that says so.
--
-- Deliberately NOT counting distinct boards: a coach re-exporting the same
-- board fifty times costs fifty encodes, and a per-board count would bill that
-- as one.

CREATE TABLE `video_exports` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `user_id`    INT NOT NULL,
  -- Kept for support ("which board was this?") and so a future per-board
  -- policy is possible without another migration. Nullable because a board
  -- may be deleted long before its export record ages out.
  `board_id`   INT NULL,
  -- The plan in force at the time. Without it, a coach who upgrades mid-month
  -- has no record of why they were capped last week.
  `plan_slug`  VARCHAR(50) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- The only query this table serves: how many has this user done since X.
  INDEX `video_exports_user_created_idx` (`user_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `video_exports`
  ADD CONSTRAINT `video_exports_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
