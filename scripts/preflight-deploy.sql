-- PRODUCTION PREFLIGHT. Reads only — changes nothing.
--
--   bash scripts/preflight-deploy.sh        (reads the connection from .env)
--
-- Run against PRODUCTION before deploying the referral + collaboration
-- release. Six sections; the first three decide whether to go ahead.
--
-- WHAT THIS RELEASE DOES TO THE DATABASE. Production has had migration
-- `17_referrals_partners` since 17 September. This release does NOT replace
-- it — that was tried, it failed on `Duplicate column name 'referral_code'`,
-- and it was the wrong idea (an applied migration is history). Instead
-- `25_partners_to_collaborators` renames and reshapes what 17 built, keeping
-- every row, and 26–32 add the rest. Section 1 checks that starting point is
-- what we think it is.
--
-- Production runs under pm2, not Docker. A failed `migrate deploy` leaves the
-- old code serving the old schema — the site stays up. The thing NOT to do
-- after a failure is `pm2 restart`.

SELECT '=== 1. Starting point: is migration 17 applied under its ORIGINAL name? ===' AS '';
-- Expected: 17_referrals_partners APPLIED, and 25_partners_to_collaborators
-- ABSENT. Anything else means this database is not where the runbook
-- assumes, and the reshape must not run until we know why.

SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '17_referrals_partners'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '25_partners_to_collaborators')
      THEN 'EXPECTED: 17_referrals_partners applied, reshape not yet run. Deploy applies 25-32.'
    WHEN EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '25_partners_to_collaborators'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
      THEN 'ALREADY DONE: the reshape has run here. Deploy will apply only what is still pending.'
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = DATABASE() AND table_name = 'partners')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = DATABASE() AND table_name = 'collaborators')
      THEN 'FRESH: neither partners nor collaborators exists. 17 will build partners, 25 will reshape it.'
    ELSE 'UNEXPECTED: stop and send sections 1, 3 and 4 before doing anything.'
  END AS verdict;

SELECT '=== 2. Rows the reshape must carry across ===' AS '';
-- Whatever these say, migration 25 keeps them. They are here so the same
-- numbers can be checked after the deploy: they must match exactly. Built as
-- prepared statements because the tables are renamed by this release, and a
-- preflight that dies halfway is worse than one that never asked.

SET @has_partners = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'partners');
SET @has_collab = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'collaborators');
SET @has_referrals = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'referrals');
SET @has_code = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'referral_code');

SET @q = CASE
  WHEN @has_partners > 0 THEN
    'SELECT ''partners'' AS tbl, COUNT(*) AS rows_ FROM partners
     UNION ALL SELECT ''partner_commissions'', COUNT(*) FROM partner_commissions'
  WHEN @has_collab > 0 THEN
    'SELECT ''collaborators'' AS tbl, COUNT(*) AS rows_ FROM collaborators
     UNION ALL SELECT ''collaborator_commissions'', COUNT(*) FROM collaborator_commissions'
  ELSE 'SELECT ''(no partner/collaborator tables yet)'' AS tbl, 0 AS rows_'
END;
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @q = IF(@has_referrals > 0,
  'SELECT ''referrals'' AS tbl, COUNT(*) AS rows_ FROM referrals
   UNION ALL SELECT ''referral_rewards'', COUNT(*) FROM referral_rewards',
  'SELECT ''(no referral tables yet)'' AS tbl, 0 AS rows_');
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @q = IF(@has_code > 0,
  'SELECT ''users with a referral code'' AS tbl, COUNT(*) AS rows_ FROM users WHERE referral_code IS NOT NULL',
  'SELECT ''(users.referral_code not yet added)'' AS tbl, 0 AS rows_');
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '=== 3. Any migration in a FAILED state? ===' AS '';
-- Must be 0. One failed row blocks every future `migrate deploy` with P3009.
-- If it is not 0, the fix is:  npx prisma migrate resolve --rolled-back NAME

SELECT COUNT(*) AS failed_migrations,
       GROUP_CONCAT(migration_name) AS which_ones
FROM _prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

SELECT '=== 4. Recent migration history ===' AS '';
-- Expect everything through 24 applied, then a gap. This release lands 25-32
-- together. A rolled_back_at on 17_referrals_collaborations is the trace of
-- the failed attempt on 22 September and is harmless.

SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 12;

SELECT '=== 5. Club prices — do they need re-seeding? ===' AS '';
-- The referral cap needs club annual = 10x monthly. At the old £249/£399/£699
-- a club referring a club costs 10.04%, quietly over the cap.

SELECT slug, monthly_price, annual_price,
  IF(annual_price >= monthly_price * 10, 'ok', 'RE-SEED NEEDED') AS cap_safe
FROM membership_plans
WHERE slug IN ('club-5', 'club-10', 'club-20')
ORDER BY slug;

SELECT '=== 6. Server ===' AS '';
-- Migration 25 uses window functions and multi-table UPDATE: MySQL 8.0+ or
-- MariaDB 10.2+. Both are what Ubuntu 24.04 ships.

SELECT VERSION() AS db_version, DATABASE() AS db_name, NOW() AS checked_at;
