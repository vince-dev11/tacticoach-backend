-- FINANCE (28 Oct 2026, owner): Admin → Finance. A ledger of Stripe balance
-- transactions (INR, with fees) and the business's expenses, for the profit
-- and loss. New tables only; nothing existing changes.
CREATE TABLE `finance_transactions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `stripe_txn_id` VARCHAR(64) NOT NULL,
  `kind` ENUM('subscription', 'book', 'refund', 'fee', 'other') NOT NULL,
  `refund_of` ENUM('subscription', 'book', 'refund', 'fee', 'other') NULL,
  `currency` VARCHAR(3) NOT NULL,
  `amount` INTEGER NOT NULL,
  `fee` INTEGER NOT NULL DEFAULT 0,
  `net` INTEGER NOT NULL,
  `charge_amount` INTEGER NULL,
  `charge_currency` VARCHAR(3) NULL,
  `payment_intent` VARCHAR(255) NULL,
  `user_id` INTEGER NULL,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `occurred_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `finance_transactions_stripe_txn_id_key`(`stripe_txn_id`),
  INDEX `finance_transactions_occurred_at_idx`(`occurred_at`),
  INDEX `finance_transactions_kind_occurred_at_idx`(`kind`, `occurred_at`),
  INDEX `finance_transactions_payment_intent_idx`(`payment_intent`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `finance_expenses` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` DATE NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `supplier` VARCHAR(120) NOT NULL DEFAULT '',
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `amount` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `amount_inr` INTEGER NOT NULL,
  `repeat` ENUM('none', 'monthly', 'yearly') NOT NULL DEFAULT 'none',
  `repeat_until` DATE NULL,
  `repeat_of_id` INTEGER NULL,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `finance_expenses_repeat_of_id_date_key`(`repeat_of_id`, `date`),
  INDEX `finance_expenses_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
