-- Referral programme (credit, self-serve) and Collaboration programme (commission,
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
  -- The plan the new customer BOUGHT, as a slug. Their annual price is the
  -- denominator of the 10% cap, so this is what decides the reward. A slug
  -- rather than an enum because the rate is computed from prices: adding a
  -- plan must not mean an ALTER TABLE and a migration.
  `referred_plan` VARCHAR(32) NOT NULL DEFAULT 'pro',
  -- The plan the REFERRER was on when this qualified. Locked in, not read
  -- live: a coach who upgrades to Club would otherwise have their rate jump
  -- mid-programme and rewards they already hold would stop being owed.
  `referrer_plan` VARCHAR(32) NOT NULL DEFAULT 'pro',
  -- First cleared payment, and which invoice it was. The invoice id is kept
  -- so a retried webhook cannot be counted as a second payment.
  `first_payment_at` DATETIME(3) NULL,
  `first_invoice_id` VARCHAR(191) NULL,
  -- Second cleared payment. A monthly customer has handed over one instalment
  -- when the reward would otherwise be earned, so monthly waits for this.
  `second_payment_at` DATETIME(3) NULL,
  `qualified_at` DATETIME(3) NULL,
  `reversed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `referrals_referred_user_id_key`(`referred_user_id`),
  INDEX `referrals_referrer_id_status_plans_idx`(`referrer_id`, `status`, `referrer_plan`, `referred_plan`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- (user, referrer_plan, referred_plan, cycle) UNIQUE is what makes granting
-- idempotent: what is owed is recomputed from the qualified count on every
-- event, so the insert must be the thing that refuses to pay the same award
-- twice. `every` records the rate in force at the time, for the same reason
-- the collaboration programme copies its commission rate onto each statement line —
-- a price change must never restate history.
CREATE TABLE `referral_rewards` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `referrer_plan` VARCHAR(32) NOT NULL DEFAULT 'pro',
  `referred_plan` VARCHAR(32) NOT NULL DEFAULT 'pro',
  `cycle` INTEGER NOT NULL,
  `every` INTEGER NOT NULL,
  `months` INTEGER NOT NULL,
  `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  UNIQUE INDEX `referral_rewards_user_id_referrer_plan_referred_plan_cycle_key`(`user_id`, `referrer_plan`, `referred_plan`, `cycle`),
  INDEX `referral_rewards_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `collaborators` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  -- `invited` is the state between "we asked them" and "they agreed". Comped
  -- access and commission both start only at `active`.
  `status` ENUM('invited', 'active', 'suspended', 'ended') NOT NULL DEFAULT 'invited',
  -- TWO rates, as fractions. A club is a harder sale than a coach — a
  -- committee decision over months rather than one person deciding in minutes
  -- — so it is paid five points more. Which one applies is resolved per
  -- invoice from the plan that invoice is FOR, so a coach who upgrades to a
  -- club plan moves their collaborator up from that invoice onward.
  `coach_rate` DECIMAL(6, 4) NOT NULL DEFAULT 0.1500,
  `club_rate` DECIMAL(6, 4) NOT NULL DEFAULT 0.2000,
  `company_name` VARCHAR(150) NULL,
  `agreement_signed_at` DATETIME(3) NULL,
  `agreement_version` VARCHAR(16) NULL,
  `agreement_ip` VARCHAR(64) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `collaborators_user_id_key`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- Money in minor units (pence) as INTEGER. A DECIMAL read back through a JS
-- number is a rounding bug that surfaces when someone disputes an invoice.
CREATE TABLE `collaborator_commissions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `collaborator_id` INTEGER NOT NULL,
  `customer_id` INTEGER NOT NULL,
  `provider_invoice_id` VARCHAR(191) NOT NULL,
  `net_amount` INTEGER NOT NULL,
  `rate` DECIMAL(6, 4) NOT NULL,
  `commission_amount` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
  `reversed_at` DATETIME(3) NULL,
  `paid_out_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `collaborator_commissions_provider_invoice_id_key`(`provider_invoice_id`),
  INDEX `collaborator_commissions_collaborator_id_created_at_idx`(`collaborator_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `referrals` ADD CONSTRAINT `referrals_referrer_id_fkey`
  FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `referrals` ADD CONSTRAINT `referrals_referred_user_id_fkey`
  FOREIGN KEY (`referred_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `referral_rewards` ADD CONSTRAINT `referral_rewards_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collaborators` ADD CONSTRAINT `collaborators_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collaborator_commissions` ADD CONSTRAINT `collaborator_commissions_collaborator_id_fkey`
  FOREIGN KEY (`collaborator_id`) REFERENCES `collaborators`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collaborator_commissions` ADD CONSTRAINT `collaborator_commissions_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
