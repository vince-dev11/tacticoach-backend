-- ACTIVITY-LOG (23 Nov 2026, owner: "what exactly users are doing"): our own
-- record of what coach and club accounts do in the app, for Admin → Analytics.
-- Never players or parents; deleted with the account; kept 13 months.
CREATE TABLE `activity_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `event` VARCHAR(60) NOT NULL,
  `props` JSON NULL,
  `path` VARCHAR(120) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `activity_events_created_at_idx`(`created_at`),
  INDEX `activity_events_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `activity_events_event_created_at_idx`(`event`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `activity_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
