-- COACH-COUNTRY (26 Oct 2026): the country a coach coaches in, and a club's
-- default for its coaches. Both optional; suggestions only (format hint, age
-- names). ISO 3166-1 alpha-2, or GB-ENG / GB-SCT / GB-WLS / GB-NIR.
ALTER TABLE `users` ADD COLUMN `coach_country` VARCHAR(8) NULL;
ALTER TABLE `clubs` ADD COLUMN `country` VARCHAR(8) NULL;
