-- COACH-ARTICLES (20 Oct 2026): coaches write articles; nothing goes live
-- until an admin approves it. The admin adds the SEO keywords.
--
-- `status` gains the review states. `author_kind` says whether the post is the
-- team's own (admin-written, as before) or a coach's; `submitted_at` /
-- `reviewed_at` / `review_note` are the review trail the coach sees.
ALTER TABLE `blog_posts` MODIFY `status` ENUM('draft', 'pending', 'changes_requested', 'rejected', 'published') NOT NULL DEFAULT 'draft';
ALTER TABLE `blog_posts` ADD COLUMN `author_kind` ENUM('team', 'coach') NOT NULL DEFAULT 'team';
ALTER TABLE `blog_posts` ADD COLUMN `seo_keywords` JSON NULL;
ALTER TABLE `blog_posts` ADD COLUMN `submitted_at` DATETIME(3) NULL;
ALTER TABLE `blog_posts` ADD COLUMN `reviewed_at` DATETIME(3) NULL;
ALTER TABLE `blog_posts` ADD COLUMN `review_note` VARCHAR(500) NULL;
CREATE INDEX `blog_posts_author_id_idx` ON `blog_posts`(`author_id`);
