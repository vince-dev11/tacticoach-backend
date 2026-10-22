-- ASK (21 Oct 2026): the help assistant's question log.
--
-- Deliberately WITHOUT the account: the language, the question, how it was
-- answered and which help topics were used — enough to find gaps in the help,
-- nothing that says who asked.

CREATE TABLE `assistant_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locale` VARCHAR(8) NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `mode` VARCHAR(12) NOT NULL,
    `unsure` BOOLEAN NOT NULL DEFAULT false,
    `source_ids` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `assistant_questions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
