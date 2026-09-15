-- Referral programme (credit, self-serve) and Partner programme (commission,
-- invite-only). They share one idea — a coach brings another coach — and
-- differ in everything else, so they get separate tables rather than a
-- "type" column that every query would then have to remember to filter on.

ALTER TABLE `users` ADD COLUMN `referral_code` VARCHAR(24) NULL;
CREATE UNIQUE INDEX `users_referral_code_key` ON `users`(`referral_code`);

-- At most one referrer per account: `referred_user_id` is UNIQUE. Attribution
-- is decided once, at signup, and never reassigned.
CREATE TABLE `referrals` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `referrer_id` INTEGER NOT NULL,
  `referred_user_id` INTEGER NOT NULL,
  `code` VARCHAR(24) NOT NULL,
  `status` ENUM('pending', 'qualified', 'reversed') NOT NULL DEFAULT 'pending',
  -- Which ladder the referral counts on. Decided at the customer's first
  -- payment from the plan they bought; a club is worth ~8 coaches, so the two
  -- earn on separate ladders and must never be counted together.
  `kind` ENUM('coach', 'club') NOT NULL DEFAULT 'coach',
  -- The plan the REFERRER was on when this qualified. Locked in, not read live:
  -- a coach who upgrades to Club would otherwise have their thresholds jump
  -- mid-ladder and rewards they already hold would stop being owed.
  `referrer_tier` ENUM('coach', 'club') NOT NULL DEFAULT 'coach',
  `qualified_at` DATETIME(3) NULL,
  `reversed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `referrals_referred_user_id_key`(`referred_user_id`),
  INDEX `referrals_referrer_id_status_kind_idx`(`referrer_id`, `status`, `kind`, `referrer_tier`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- (user, referrer_tier, kind, cycle, tier) UNIQUE is what makes granting idempotent: the ladder is
-- recomputed from the qualified count on every event, so the insert must be
-- the thing that refuses to pay the same rung twice.
CREATE TABLE `referral_rewards` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `referrer_tier` ENUM('coach', 'club') NOT NULL DEFAULT 'coach',
  `kind` ENUM('coach', 'club') NOT NULL DEFAULT 'coach',
  `cycle` INTEGER NOT NULL,
  `tier` INTEGER NOT NULL,
  `months` INTEGER NOT NULL,
  `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  UNIQUE INDEX `referral_rewards_user_id_referrer_tier_kind_cycle_tier_key`(`user_id`, `referrer_tier`, `kind`, `cycle`, `tier`),
  INDEX `referral_rewards_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `partners` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  -- `invited` is the state between "we asked them" and "they agreed". Comped
  -- access and commission both start only at `active`.
  `status` ENUM('invited', 'active', 'suspended', 'ended') NOT NULL DEFAULT 'invited',
  `commission_rate` DECIMAL(6, 4) NOT NULL DEFAULT 0.2000,
  `company_name` VARCHAR(150) NULL,
  `agreement_signed_at` DATETIME(3) NULL,
  `agreement_version` VARCHAR(16) NULL,
  `agreement_ip` VARCHAR(64) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `partners_user_id_key`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- Money in minor units (pence) as INTEGER. A DECIMAL read back through a JS
-- number is a rounding bug that surfaces when someone disputes an invoice.
CREATE TABLE `partner_commissions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partner_id` INTEGER NOT NULL,
  `customer_id` INTEGER NOT NULL,
  `provider_invoice_id` VARCHAR(191) NOT NULL,
  `net_amount` INTEGER NOT NULL,
  `rate` DECIMAL(6, 4) NOT NULL,
  `commission_amount` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
  `reversed_at` DATETIME(3) NULL,
  `paid_out_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `partner_commissions_provider_invoice_id_key`(`provider_invoice_id`),
  INDEX `partner_commissions_partner_id_created_at_idx`(`partner_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `referrals` ADD CONSTRAINT `referrals_referrer_id_fkey`
  FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_referred_user_id_fkey`
  FOREIGN KEY (`referred_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `referral_rewards` ADD CONSTRAINT `referral_rewards_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `partners` ADD CONSTRAINT `partners_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `partner_commissions` ADD CONSTRAINT `partner_commissions_partner_id_fkey`
  FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `partner_commissions` ADD CONSTRAINT `partner_commissions_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
