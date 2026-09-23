-- Bring hand-written migrations into line with what Prisma expects.
--
-- This is the output of
--
--   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
--
-- run against a migrated copy of production on 23 September 2026, unchanged.
-- Migrations 22, 26, 28 and 30 were written by hand and drifted from the
-- schema in two harmless-but-real ways: nine indexes carry names a person
-- chose rather than Prisma's `table_col1_col2_idx` convention, and five
-- `updated_at` columns have a database DEFAULT that Prisma never relies on
-- (it sets @updatedAt in the client on every write).
--
-- Nothing here changes a row or a query plan. It exists so that
-- scripts/verify-migrations.sh reports NO DRIFT — which is the only state in
-- which that check is worth having. A check that always finds something is
-- one that everybody learns to ignore.

-- AlterTable
ALTER TABLE `ebook_chapters` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ebook_notes` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ebook_progress` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ebooks` ALTER COLUMN `updated_at` DROP DEFAULT;

-- AlterTable
ALTER TABLE `squads` ALTER COLUMN `updated_at` DROP DEFAULT;

-- RenameIndex
ALTER TABLE `agreement_acceptances` RENAME INDEX `agreement_acceptances_user_kind_idx` TO `agreement_acceptances_user_id_kind_idx`;

-- RenameIndex
ALTER TABLE `agreement_acceptances` RENAME INDEX `agreement_acceptances_user_kind_version_key` TO `agreement_acceptances_user_id_kind_version_key`;

-- RenameIndex
ALTER TABLE `ebook_blocks` RENAME INDEX `ebook_blocks_chapter_order_idx` TO `ebook_blocks_chapter_id_sort_order_idx`;

-- RenameIndex
ALTER TABLE `ebook_chapters` RENAME INDEX `ebook_chapters_book_order_idx` TO `ebook_chapters_ebook_id_sort_order_idx`;

-- RenameIndex
ALTER TABLE `ebook_notes` RENAME INDEX `ebook_notes_user_book_idx` TO `ebook_notes_user_id_ebook_id_created_at_idx`;

-- RenameIndex
ALTER TABLE `ebooks` RENAME INDEX `ebooks_author_idx` TO `ebooks_author_id_idx`;

-- RenameIndex
ALTER TABLE `ebooks` RENAME INDEX `ebooks_author_status_idx` TO `ebooks_author_id_status_idx`;

-- RenameIndex
ALTER TABLE `ebooks` RENAME INDEX `ebooks_status_category_age_idx` TO `ebooks_status_category_age_band_idx`;

-- RenameIndex
ALTER TABLE `video_exports` RENAME INDEX `video_exports_user_created_idx` TO `video_exports_user_id_created_at_idx`;
