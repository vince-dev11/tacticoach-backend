-- Partners become collaborators; referrals move from tiers to plans.
--
-- WHY THIS MIGRATION EXISTS. Migration 17 (`17_referrals_partners`) has been
-- applied in production since 17 September 2026. For the collaboration
-- release it was renamed and rewritten in place — which to Prisma is a new
-- migration trying to CREATE tables that already exist. It failed on its
-- first statement (`Duplicate column name 'referral_code'`), changed nothing,
-- and taught the lesson properly: an applied migration is history, and
-- history is not edited. The original 17 is restored byte-for-byte; the
-- change it was rewritten to make is THIS file, as the forward step it should
-- have been all along.
--
-- WHY NUMBER 25. Migrations run in name order and 32 alters `collaborators`,
-- so the rename has to land before it. The 25 slot is free everywhere:
-- `25_partner_rate_default` was deleted before it was ever applied, and its
-- one job (the 15% coach default) is done below.
--
-- EVERY ROW SURVIVES. Nothing here drops a table or deletes a row. Columns
-- are added, back-filled from what is already there, and only then are the
-- old ones removed. Where the old data cannot say exactly what the new column
-- means, the mapping is written down next to the statement rather than
-- guessed silently.
--
-- DIALECT. Written to run unchanged on MySQL 8 and MariaDB 10.5+: CHANGE
-- COLUMN with a full definition rather than RENAME COLUMN, DROP + CREATE
-- INDEX rather than RENAME INDEX, and no IF EXISTS anywhere. The tables are
-- small; the extra rebuilds cost nothing and remove a class of surprise.
--
-- Index and constraint names follow Prisma's own convention
-- (`table_col1_col2_idx`, `_key`, `_fkey`) so that `prisma migrate diff`
-- against the schema reports NO drift afterwards. That diff is the test; see
-- scripts/verify-migrations.sh.

-- =============================================================================
-- 1. referrals: `kind` / `referrer_tier` (coach|club) → plan slugs, plus the
--    first/second-payment columns the monthly bar needs.
-- =============================================================================

ALTER TABLE `referrals`
  ADD COLUMN `referred_plan`     VARCHAR(32)  NOT NULL DEFAULT 'pro' AFTER `status`,
  ADD COLUMN `referrer_plan`     VARCHAR(32)  NOT NULL DEFAULT 'pro' AFTER `referred_plan`,
  ADD COLUMN `first_payment_at`  DATETIME(3)  NULL AFTER `referrer_plan`,
  ADD COLUMN `first_invoice_id`  VARCHAR(191) NULL AFTER `first_payment_at`,
  ADD COLUMN `second_payment_at` DATETIME(3)  NULL AFTER `first_invoice_id`;

-- The plan the referred customer is on NOW is the best available answer to
-- "what did they buy". Where they have no subscription row, fall back to the
-- coarse old value: a `club` kind becomes the middle club plan, anything else
-- Pro. For a still-pending referral this is only a placeholder — the service
-- overwrites it at their first payment, which is when it is actually decided.
UPDATE `referrals` r
  LEFT JOIN `user_subscriptions` us ON us.`user_id` = r.`referred_user_id`
  LEFT JOIN `membership_plans`   p  ON p.`id`       = us.`plan_id`
  SET r.`referred_plan` = COALESCE(p.`slug`, IF(r.`kind` = 'club', 'club-10', 'pro'));

UPDATE `referrals` r
  LEFT JOIN `user_subscriptions` us ON us.`user_id` = r.`referrer_id`
  LEFT JOIN `membership_plans`   p  ON p.`id`       = us.`plan_id`
  SET r.`referrer_plan` = COALESCE(p.`slug`, IF(r.`referrer_tier` = 'club', 'club-10', 'pro'));

-- A referral only ever qualified because a payment cleared, so the moment it
-- qualified is the closest thing on record to that first payment. The
-- invoice id was not stored under the old rules and stays NULL; the retry
-- guard it feeds only matters for payments from here on.
UPDATE `referrals`
  SET `first_payment_at` = `qualified_at`
  WHERE `qualified_at` IS NOT NULL AND `first_payment_at` IS NULL;

ALTER TABLE `referrals` DROP INDEX `referrals_referrer_id_status_kind_idx`;
ALTER TABLE `referrals` DROP COLUMN `kind`, DROP COLUMN `referrer_tier`;
CREATE INDEX `referrals_referrer_id_status_referrer_plan_referred_plan_idx`
  ON `referrals`(`referrer_id`, `status`, `referrer_plan`, `referred_plan`);

-- =============================================================================
-- 2. referral_rewards: the idempotency key changes shape.
--    Old: (user, referrer_tier, kind, cycle, tier)   New: (user, referrer_plan, referred_plan, cycle)
-- =============================================================================

ALTER TABLE `referral_rewards`
  ADD COLUMN `referrer_plan` VARCHAR(32) NOT NULL DEFAULT 'pro' AFTER `user_id`,
  ADD COLUMN `referred_plan` VARCHAR(32) NOT NULL DEFAULT 'pro' AFTER `referrer_plan`,
  -- Temporarily defaulted so the ADD succeeds on a populated table; the
  -- default is removed once every row has a value, because the schema has
  -- none and a silent default here would hide a bug in the service later.
  ADD COLUMN `every`         INTEGER     NOT NULL DEFAULT 1     AFTER `cycle`;

UPDATE `referral_rewards` rr
  LEFT JOIN `user_subscriptions` us ON us.`user_id` = rr.`user_id`
  LEFT JOIN `membership_plans`   p  ON p.`id`       = us.`plan_id`
  SET rr.`referrer_plan` = COALESCE(p.`slug`, IF(rr.`referrer_tier` = 'club', 'club-10', 'pro')),
      rr.`referred_plan` = IF(rr.`kind` = 'club', 'club-10', 'pro');

-- Old rewards were numbered (cycle, tier) — a run through the ladder and a
-- rung on it. New ones are numbered by a single award counter. Renumber the
-- existing rows 1..n within each new key, in the order they were earned, so
-- that (a) no two rows collide on the new unique index and (b) the service's
-- recompute sees awards 1..n as already paid and never grants them twice.
-- Their `months` — the thing actually owed — is untouched.
--
-- A temporary table because MySQL will not UPDATE a table it is also reading
-- in a window function, and MariaDB is picky about it in a different way.
CREATE TEMPORARY TABLE `_rr_renumber` AS
  SELECT `id`,
         ROW_NUMBER() OVER (
           PARTITION BY `user_id`, `referrer_plan`, `referred_plan`
           ORDER BY `cycle`, `tier`, `id`
         ) AS `rn`
  FROM `referral_rewards`;
UPDATE `referral_rewards` rr JOIN `_rr_renumber` x ON x.`id` = rr.`id` SET rr.`cycle` = x.`rn`;
DROP TEMPORARY TABLE `_rr_renumber`;

ALTER TABLE `referral_rewards` DROP INDEX `referral_rewards_user_id_referrer_tier_kind_cycle_tier_key`;
ALTER TABLE `referral_rewards` DROP COLUMN `tier`, DROP COLUMN `kind`, DROP COLUMN `referrer_tier`;
ALTER TABLE `referral_rewards` MODIFY COLUMN `every` INTEGER NOT NULL;
CREATE UNIQUE INDEX `referral_rewards_user_id_referrer_plan_referred_plan_cycle_key`
  ON `referral_rewards`(`user_id`, `referrer_plan`, `referred_plan`, `cycle`);

-- =============================================================================
-- 3. partners → collaborators, one rate → two.
-- =============================================================================

-- Foreign keys first. They are named after the old tables, and InnoDB will
-- not let the index under a live foreign key be dropped.
ALTER TABLE `partner_commissions` DROP FOREIGN KEY `partner_commissions_partner_id_fkey`;
ALTER TABLE `partner_commissions` DROP FOREIGN KEY `partner_commissions_customer_id_fkey`;
ALTER TABLE `partners`            DROP FOREIGN KEY `partners_user_id_fkey`;

RENAME TABLE `partners`            TO `collaborators`,
             `partner_commissions` TO `collaborator_commissions`;

ALTER TABLE `collaborators`
  ADD COLUMN `coach_rate` DECIMAL(6, 4) NOT NULL DEFAULT 0.1500 AFTER `status`,
  ADD COLUMN `club_rate`  DECIMAL(6, 4) NOT NULL DEFAULT 0.2000 AFTER `coach_rate`;

-- Anyone already on the programme signed an agreement that named ONE rate,
-- with no coach/club split. The only mapping that cannot pay them less than
-- they agreed to is that rate for both. The 15% / 20% defaults above apply
-- to NEW collaborators only. If an existing partner's rate should now differ
-- by customer type, that is an admin decision to make per person, with their
-- agreement in front of you — not something a migration should decide.
UPDATE `collaborators` SET `coach_rate` = `commission_rate`, `club_rate` = `commission_rate`;
ALTER TABLE `collaborators` DROP COLUMN `commission_rate`;

ALTER TABLE `collaborators` DROP INDEX `partners_user_id_key`;
CREATE UNIQUE INDEX `collaborators_user_id_key` ON `collaborators`(`user_id`);
ALTER TABLE `collaborators` ADD CONSTRAINT `collaborators_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Full definition repeated on purpose: CHANGE COLUMN replaces it wholesale,
-- and an omitted NOT NULL here would silently make the column nullable.
ALTER TABLE `collaborator_commissions`
  CHANGE COLUMN `partner_id` `collaborator_id` INTEGER NOT NULL;

ALTER TABLE `collaborator_commissions` DROP INDEX `partner_commissions_provider_invoice_id_key`;
ALTER TABLE `collaborator_commissions` DROP INDEX `partner_commissions_partner_id_created_at_idx`;
CREATE UNIQUE INDEX `collaborator_commissions_provider_invoice_id_key`
  ON `collaborator_commissions`(`provider_invoice_id`);
CREATE INDEX `collaborator_commissions_collaborator_id_created_at_idx`
  ON `collaborator_commissions`(`collaborator_id`, `created_at`);

ALTER TABLE `collaborator_commissions` ADD CONSTRAINT `collaborator_commissions_collaborator_id_fkey`
  FOREIGN KEY (`collaborator_id`) REFERENCES `collaborators`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collaborator_commissions` ADD CONSTRAINT `collaborator_commissions_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
