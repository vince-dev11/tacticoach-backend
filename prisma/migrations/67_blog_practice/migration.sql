-- BLOG-V4 (19 Nov 2026, owner approved the blog design): an article can say
-- who it is for and carry the practice it describes. All optional; a post
-- without them shows as before.
--   age_group  free text shown as a label ("U9–U11")
--   formats    JSON array of '5v5' | '7v7' | '8v8' | '9v9' | '11v11' (the Format filter)
--   practice   JSON { players, area, time, equipment } — the "The practice" box
ALTER TABLE `blog_posts`
  ADD COLUMN `age_group` VARCHAR(40) NULL,
  ADD COLUMN `formats` JSON NULL,
  ADD COLUMN `practice` JSON NULL;
