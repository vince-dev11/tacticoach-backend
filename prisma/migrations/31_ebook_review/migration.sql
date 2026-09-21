-- Coach-written books go through review before they reach the shop.
--
-- Until now `ebooks.status` was draft | published | archived and the only
-- author was the company owner, so "published" could mean "live" safely.
-- Once any coach can publish, the word has to split in two: what the AUTHOR
-- did (submitted it) and what WE decided (it is public). Conflating them is
-- how a stranger's first book lands on the front page of the shop.
--
-- `in_review` sits between draft and published. The author cannot skip it;
-- only an owner moves a book from in_review to published. `rejected` sends it
-- back WITH A REASON — a rejection with no reason is the same as silence, and
-- the coach just resubmits the identical book.
--
-- Mirrors clubs.page_status (none/pending/approved/rejected/suspended), which
-- already solves this exact problem for club pages. Same words would have been
-- better; `published` is kept because it is already written into the shop's
-- queries, the reader's chapter gate and every seeded row.

ALTER TABLE `ebooks`
  MODIFY COLUMN `status` ENUM('draft', 'in_review', 'published', 'rejected', 'archived')
    NOT NULL DEFAULT 'draft';

ALTER TABLE `ebooks`
  -- When the author last submitted it. Distinct from published_at, which is
  -- stamped on first APPROVAL and never moves after: a book rejected twice and
  -- approved on the third pass is not three months old in the shop.
  ADD COLUMN `submitted_at` DATETIME(3) NULL AFTER `published_at`,
  -- Shown to the author, so "rejected" is actionable rather than mysterious.
  ADD COLUMN `review_note` VARCHAR(500) NULL AFTER `submitted_at`;

-- The shop reads (status, category, age_band) and the author's own list reads
-- (author_id, status). The first index exists; this is the second.
CREATE INDEX `ebooks_author_status_idx` ON `ebooks` (`author_id`, `status`);
