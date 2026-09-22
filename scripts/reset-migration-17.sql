-- Recovery for a half-applied migration 17.
--
-- READ scripts/diagnose-migration-17.sql OUTPUT FIRST. This script DROPS
-- things. It is safe on a development database where the referral and
-- collaboration features have never been used — which is the situation it was
-- written for — and it is not safe anywhere else.
--
-- WHAT HAPPENED. `users.referral_code` existed before migration 17 ran, so
-- something created it outside the migration history — almost certainly
-- `prisma db push`, which syncs the schema and records nothing. Prisma then
-- tried to add the column again and stopped on the first statement.
--
-- WHY NOT JUST `IF NOT EXISTS`. Because the tables that already exist are in
-- their OLD shape: `referrals` with `kind` and `referrer_tier`, and `partners`
-- rather than `collaborators`. Skipping their creation would leave those
-- columns in place. The deploy would succeed, the build would be green, and
-- the first referral to qualify would die on "Unknown column `referrer_plan`".
-- A migration that half-runs is better than one that lies about having run.
--
-- ORDER OF PLAY:
--
--   1. mysql -u root -p tacticoach < scripts/diagnose-migration-17.sql
--   2. read it — if `users_with_a_code` is not 0, or any of these tables hold
--      rows you care about, STOP and say so rather than running this
--   3. mysql -u root -p tacticoach < scripts/reset-migration-17.sql
--   4. npx prisma migrate resolve --rolled-back 17_referrals_collaborations
--   5. npx prisma migrate deploy
--   6. npx prisma generate
--   7. npx tsx prisma/seed.ts

SET FOREIGN_KEY_CHECKS = 0;

-- Children first, though the checks are off — it reads in dependency order,
-- which is how somebody reviewing this will expect it.
DROP TABLE IF EXISTS `collaborator_commissions`;
DROP TABLE IF EXISTS `partner_commissions`;
DROP TABLE IF EXISTS `collaborators`;
DROP TABLE IF EXISTS `partners`;
DROP TABLE IF EXISTS `referral_rewards`;
DROP TABLE IF EXISTS `referrals`;

-- Migration 32's table, in case a later attempt got that far.
DROP TABLE IF EXISTS `collaboration_applications`;

SET FOREIGN_KEY_CHECKS = 1;

-- The column that actually stopped the migration. The index goes with it —
-- MariaDB drops it automatically with the column, but naming it here means the
-- script reads as the reverse of what migration 17 does rather than relying on
-- that.
ALTER TABLE `users` DROP INDEX IF EXISTS `users_referral_code_key`;
ALTER TABLE `users` DROP COLUMN IF EXISTS `referral_code`;

-- Nothing to do for migration 32's ALTER on `collaborators`: that table is
-- dropped above, and its columns go with it. An `ALTER TABLE collaborators`
-- here would fail on a table that no longer exists — MariaDB's IF EXISTS
-- covers the column, not the table.

SELECT 'Dropped. Now run: npx prisma migrate resolve --rolled-back 17_referrals_collaborations' AS 'next';
