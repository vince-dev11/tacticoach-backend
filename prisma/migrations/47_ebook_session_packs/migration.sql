-- Session packs (2 Oct 2026): a book or course can carry the author's own
-- sessions. Each is FROZEN when attached (a snapshot, not a link), and a
-- reader with access gets editable copies in their own library.
--
--   ebook_session_packs            — the frozen sessions a book carries
--   training_sessions.source_ebook_id — set on a reader's copy: which book it
--                                    came from. Copies never count against
--                                    plan or free-trial session limits, and a
--                                    refund removes them.
--
-- Additive only.

CREATE TABLE `ebook_session_packs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ebook_id` INT NOT NULL,
  `source_session_id` INT NULL,
  `title` VARCHAR(255) NOT NULL,
  `snapshot` JSON NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ebook_session_packs_ebook_id_sort_order_idx` (`ebook_id`, `sort_order`),
  CONSTRAINT `ebook_session_packs_ebook_id_fkey` FOREIGN KEY (`ebook_id`) REFERENCES `ebooks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `training_sessions`
  ADD COLUMN `source_ebook_id` INT NULL,
  ADD INDEX `training_sessions_user_id_source_ebook_id_idx` (`user_id`, `source_ebook_id`);
