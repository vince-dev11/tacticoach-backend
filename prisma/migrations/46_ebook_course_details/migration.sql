-- Who a book or course is for, beyond the age band (2 Oct 2026):
--
--   format  — the match format it is written for: 3v3 5v5 7v7 9v9 11v11 mixed.
--             Chosen by the author, never derived from the age band (formats
--             differ by country and change — FA FutureFit from 2026/27).
--   country — the governing-body context: eng sco wal nir irl usa. NULL = any.
--   topics  — up to three topic slugs as ",pressing,finishing," so the shop can
--             filter with a plain LIKE on an indexed-free small table.
--
-- Additive only; NULL everywhere for existing books.

ALTER TABLE `ebooks`
  ADD COLUMN `format` VARCHAR(8) NULL,
  ADD COLUMN `country` VARCHAR(4) NULL,
  ADD COLUMN `topics` VARCHAR(200) NULL;
