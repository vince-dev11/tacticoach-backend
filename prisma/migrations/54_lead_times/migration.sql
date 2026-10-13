-- LEAD-ONCE (13 Oct 2026): one lead per person. A visitor who asks again from
-- the same email joins their open lead instead of starting a new one; `times`
-- counts how often they have written. Existing rows count once.
ALTER TABLE `contact_messages` ADD COLUMN `times` INTEGER NOT NULL DEFAULT 1;
