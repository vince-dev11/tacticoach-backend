-- What the person said they were at signup: coach, club or player.
--
-- Deliberately NOT an authorisation column. Access is resolved from the
-- subscription, the club seat and the partner record; this only routes
-- onboarding and segments reporting. Existing accounts are all coaches,
-- which is what they were when they signed up.
ALTER TABLE `users`
  ADD COLUMN `account_type` ENUM('coach', 'club', 'player') NOT NULL DEFAULT 'coach';

-- Anyone who already owns a club plainly signed up as one.
UPDATE `users` u
  JOIN `clubs` c ON c.`owner_id` = u.`id`
  SET u.`account_type` = 'club';
