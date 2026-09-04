-- "My Squad": the coach's real players, entered once in the profile. The
-- editor's shelf and formation presets read from this so boards animate the
-- coach's actual team (names under tokens), not anonymous numbers.
CREATE TABLE `squad_players` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `number` VARCHAR(3) NOT NULL,
  `position` VARCHAR(4) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `squad_players_user_id_sort_order_idx` (`user_id`, `sort_order`),
  CONSTRAINT `squad_players_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
