-- What state is this database actually in?
--
-- Run this BEFORE trying to fix migration 17. It reads only — nothing here
-- changes anything — and its job is to answer one question: did a `prisma db
-- push` create the referral tables in their OLD shape?
--
--   mysql -u root -p tacticoach < scripts/diagnose-migration-17.sql
--
-- The tempting fix for "Duplicate column name" is to add IF NOT EXISTS to
-- migration 17 and re-run it. Do not do that until you have read section 2
-- below. If `referrals` already exists with `kind` and `referrer_tier`, a
-- skipped CREATE TABLE leaves those columns in place, the deploy succeeds, and
-- the first referral that qualifies dies with "Unknown column referrer_plan".

SELECT '=== 1. Which of migration 17 and 32 objects already exist? ===' AS '';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'referrals', 'referral_rewards',
    'partners', 'partner_commissions',
    'collaborators', 'collaborator_commissions',
    'agreement_acceptances', 'collaboration_applications'
  )
ORDER BY table_name;

SELECT '=== 2. If `referrals` exists, is it the OLD or NEW shape? ===' AS '';
-- OLD shape has: kind, referrer_tier
-- NEW shape has: referrer_plan, referred_plan, first_payment_at, second_payment_at
SELECT column_name
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'referrals'
ORDER BY ordinal_position;

SELECT '=== 3. Is there anything in them worth keeping? ===' AS '';
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'referrals') AS referrals_table_exists,
  (SELECT COUNT(*) FROM users WHERE referral_code IS NOT NULL) AS users_with_a_code;

SELECT '=== 4. What does Prisma think it has applied? ===' AS '';
SELECT
  migration_name,
  finished_at,
  rolled_back_at,
  applied_steps_count,
  (logs IS NOT NULL) AS failed_with_an_error
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 12;
