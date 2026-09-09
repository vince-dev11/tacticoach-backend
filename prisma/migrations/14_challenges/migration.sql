-- Weekly tactical challenge: a scenario posted each week, coaches submit a
-- board that answers it, the community votes. "Current winner" and "past
-- winners" are computed at read time from vote counts -- no status/winner
-- column, no background job.
CREATE TABLE `challenges` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(150) NOT NULL,
  `prompt` TEXT NOT NULL,
  `tag` VARCHAR(20) NULL,
  `starts_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `challenges_starts_at_ends_at_idx` (`starts_at`, `ends_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `challenge_submissions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `challenge_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `board_id` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `challenge_submissions_challenge_id_user_id_key` (`challenge_id`, `user_id`),
  INDEX `challenge_submissions_board_id_idx` (`board_id`),
  CONSTRAINT `challenge_submissions_challenge_id_fkey` FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `challenge_submissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `challenge_submissions_board_id_fkey` FOREIGN KEY (`board_id`) REFERENCES `canvas_boards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `challenge_votes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `submission_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `challenge_votes_submission_id_user_id_key` (`submission_id`, `user_id`),
  INDEX `challenge_votes_user_id_idx` (`user_id`),
  CONSTRAINT `challenge_votes_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `challenge_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `challenge_votes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
