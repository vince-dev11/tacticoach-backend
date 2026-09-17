-- Leads: where they came from, and what they are.
--
-- `contact_messages` has been doing two jobs under one name. It was built as
-- the contact-form inbox, then the admin area started calling it "Leads" —
-- which is what it is, but only one kind: somebody who filled in the form on
-- the website. There was no way to write down a coach met at a tournament, and
-- no way to tell the two apart once both were in the table.
--
-- Extended rather than replaced. A second `leads` table would mean two
-- inboxes to check, the contact form feeding one and the sales list the other,
-- and somebody eventually asking which one is real. A lead is a lead; where it
-- came from is a column.

-- Where the row came from.
--   web    — the contact form on the website (everything that exists today)
--   direct — typed in by hand by an admin
--   import — came in on a spreadsheet
ALTER TABLE `contact_messages`
  ADD COLUMN `source` ENUM('web', 'direct', 'import') NOT NULL DEFAULT 'web' AFTER `email`;

-- What they are. `unknown` is the honest default: the contact form does not
-- ask, and guessing from a message body would put a wrong label on a real
-- person. An admin sets it when they know.
ALTER TABLE `contact_messages`
  ADD COLUMN `kind` ENUM('unknown', 'coach', 'club') NOT NULL DEFAULT 'unknown' AFTER `source`;

-- An admin's own note — "met at the Ankara tournament", "asked about club
-- pricing". Separate from `message`, which is the lead's own words. Mixing the
-- two would make it impossible to quote a person back to themselves safely.
ALTER TABLE `contact_messages`
  ADD COLUMN `note` VARCHAR(500) NULL AFTER `message`;

-- A lead added by hand or from a spreadsheet has no message, because they have
-- not written to us. Storing '' would be a lie that reads as an empty message
-- in the inbox; NULL says "there isn't one".
--
-- The contact form's own validation still requires a message — this widens the
-- column, not the form.
ALTER TABLE `contact_messages`
  MODIFY COLUMN `message` TEXT NULL;

-- Every existing row is a contact-form submission, so the `source` default of
-- 'web' is already correct for them and no back-fill statement is needed. This
-- is stated rather than run so the next person does not go looking for one.

-- Filtering the list by where leads came from and what they are.
CREATE INDEX `contact_messages_source_kind_idx` ON `contact_messages` (`source`, `kind`);

-- Import dedupe checks "do we already have this address?" on every row of a
-- spreadsheet. Deliberately NOT unique: the same person is allowed to use the
-- contact form twice, and a unique index here would turn their second message
-- into a 500. Dedupe is the importer's job, not the schema's.
CREATE INDEX `contact_messages_email_idx` ON `contact_messages` (`email`);
