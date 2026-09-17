-- The default partner commission rate drops from 20% to 15%.
--
-- Column default only. EXISTING PARTNERS ARE NOT TOUCHED, deliberately: the
-- rate is stored per partner and each one's agreement states the number they
-- were offered. Re-rating them here would be quietly rewriting a signed
-- commercial term, and their own profile page renders the stored value, so
-- they would see it change.
--
-- In practice this default is belt and braces — invitePartner always supplies
-- a rate explicitly. It is updated so the schema does not tell the next person
-- something untrue about what a partner gets.

ALTER TABLE `partners`
  ALTER COLUMN `commission_rate` SET DEFAULT 0.1500;
