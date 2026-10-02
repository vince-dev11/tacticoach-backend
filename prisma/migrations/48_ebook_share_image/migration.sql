-- A share image per book (2 Oct 2026): the cover as a 1200×630 card, rendered
-- in the author's browser when they save and uploaded here, so a book link in
-- WhatsApp, Facebook or X shows the book rather than the generic site image.
-- Served from a stable URL (/api/ebooks/:slug/share.png) that redirects to a
-- fresh presigned link. Additive only.

ALTER TABLE `ebooks` ADD COLUMN `share_image_key` VARCHAR(500) NULL;
