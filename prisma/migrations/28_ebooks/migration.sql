-- Ebooks: a book is an ordered list of blocks, not a file.
--
-- Everything downstream follows from that one decision. A book made of blocks
-- can be translated (you translate text fields, not a PDF), personalised (a
-- board block resolves against the reader's own squad), served a chapter at a
-- time so no endpoint ever returns the whole thing, and edited after
-- publishing without reissuing anything.

CREATE TABLE `ebooks` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `author_id`   INT NOT NULL,
  `title`       VARCHAR(160) NOT NULL,
  `subtitle`    VARCHAR(200) NULL,
  `slug`        VARCHAR(180) NOT NULL,
  `blurb`       TEXT NULL,

  `category`    ENUM('tactics','technique','mindset','goalkeeping','fitness','set_pieces') NOT NULL DEFAULT 'tactics',
  -- Age band as an enum rather than two integer columns: "U12-14" is a thing
  -- coaches say, whereas min_age=12/max_age=14 invites someone to set 11-17
  -- and produces a filter nobody can build a tidy row of chips from.
  `age_band`    ENUM('u9_11','u12_14','u15_18','adult','all') NOT NULL DEFAULT 'all',

  -- THE COVER IS DATA, NOT AN IMAGE.
  --
  -- {template, bg, art, font, weight, style, size} — the same shape the
  -- designer produces. Rendered as vectors by one shared component, so a cover
  -- is sharp at any size, identical in the shop and the reader, weighs nothing,
  -- needs no upload, and cannot break. That last point is not hypothetical:
  -- S3 on this deployment is failing outright with a placeholder access key,
  -- which would have made image covers unshippable today.
  `cover`       JSON NOT NULL,

  -- draft -> published. Nothing but `published` is ever listed publicly; see
  -- the test that pins it.
  `status`      ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `published_at` DATETIME(3) NULL,

  -- Pence. 0 means free. Integer, never a float: money in a float is how you
  -- end up charging £4.989999999.
  `price_pence` INT NOT NULL DEFAULT 0,
  -- The language the author actually WROTE in. Translations are derived from
  -- it and labelled as such; this says which one is the original.
  `language`    VARCHAR(8) NOT NULL DEFAULT 'en',

  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `ebooks_slug_key` (`slug`),
  -- The shop's own query: published, filtered by category and age.
  INDEX `ebooks_status_category_age_idx` (`status`, `category`, `age_band`),
  INDEX `ebooks_author_idx` (`author_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RESTRICT, not CASCADE. Deleting a coach's account must not silently delete
-- books other people have read and may have paid for. If an author leaves,
-- their books are reassigned or archived deliberately.
ALTER TABLE `ebooks`
  ADD CONSTRAINT `ebooks_author_id_fkey`
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `ebook_chapters` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `ebook_id`   INT NOT NULL,
  `title`      VARCHAR(200) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  -- The first chapter is usually readable without buying. A column rather than
  -- "chapter 1 is always free", because an author may want a later chapter as
  -- the sample, and because free books have no such concept at all.
  `is_sample`  BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ebook_chapters_book_order_idx` (`ebook_id`, `sort_order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_chapters`
  ADD CONSTRAINT `ebook_chapters_ebook_id_fkey`
  FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `ebook_blocks` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `chapter_id` INT NOT NULL,
  -- text      — a paragraph or heading
  -- board     — an animated tactic, played inline; `data.boardId` points at it
  -- character — speech or narration from a recurring character
  -- your_turn — one thing to try at training
  -- quiz      — two or three questions
  -- image     — an uploaded illustration (needs S3; unusable until that is fixed)
  -- quote     — a line set large, for pacing
  `kind`       ENUM('text','board','character','your_turn','quiz','image','quote') NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  -- Shape depends on `kind`. JSON rather than fifteen nullable columns: a
  -- quiz's answers and a board's id have nothing in common, and a table where
  -- most columns are NULL on most rows teaches nobody anything.
  `data`       JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ebook_blocks_chapter_order_idx` (`chapter_id`, `sort_order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_blocks`
  ADD CONSTRAINT `ebook_blocks_chapter_id_fkey`
  FOREIGN KEY (`chapter_id`) REFERENCES `ebook_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- How far somebody has got, and their notes.
--
-- Separate from any notion of purchase: reading progress belongs to the reader
-- and survives a refund, an unpublish, or the book being archived. Their own
-- words are not licensed content.
CREATE TABLE `ebook_notes` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `user_id`    INT NOT NULL,
  `ebook_id`   INT NOT NULL,
  `chapter_id` INT NULL,
  `block_id`   INT NULL,
  -- The passage they highlighted, capped. A cap rather than TEXT on purpose:
  -- an export of somebody's notes must never become a back door to the whole
  -- book, and a "highlight" of four thousand words is not a highlight.
  `quote`      VARCHAR(600) NULL,
  `body`       VARCHAR(2000) NULL,
  `colour`     ENUM('yellow','green','blue') NOT NULL DEFAULT 'yellow',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ebook_notes_user_book_idx` (`user_id`, `ebook_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CASCADE on the user (their notes die with their account), SET NULL on the
-- chapter and block so a note survives the author reordering or deleting the
-- passage it was attached to. A note whose anchor has gone still says
-- something the reader wrote and wants to keep.
ALTER TABLE `ebook_notes`
  ADD CONSTRAINT `ebook_notes_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_notes`
  ADD CONSTRAINT `ebook_notes_ebook_id_fkey`
  FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_notes`
  ADD CONSTRAINT `ebook_notes_chapter_id_fkey`
  FOREIGN KEY (`chapter_id`) REFERENCES `ebook_chapters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ebook_notes`
  ADD CONSTRAINT `ebook_notes_block_id_fkey`
  FOREIGN KEY (`block_id`) REFERENCES `ebook_blocks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `ebook_progress` (
  `user_id`         INT NOT NULL,
  `ebook_id`        INT NOT NULL,
  `last_chapter_id` INT NULL,
  -- 0-100. Enough for "38%" and for the minimum-read rule a rating will need
  -- later; anything finer is pretending to a precision we do not have.
  `percent`         TINYINT NOT NULL DEFAULT 0,
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `ebook_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ebook_progress`
  ADD CONSTRAINT `ebook_progress_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ebook_progress`
  ADD CONSTRAINT `ebook_progress_ebook_id_fkey`
  FOREIGN KEY (`ebook_id`) REFERENCES `ebooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
