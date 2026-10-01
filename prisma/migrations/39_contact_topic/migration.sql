-- What a contact-form message is about, chosen by the person writing it.
--
-- The form used to go straight into Leads, so a complaint, a login problem and
-- a club asking for a demo all sat in one list as "leads". The topic splits
-- them: sales and club topics stay in Admin → Leads, everything else goes to
-- Admin → Support.
--
-- A plain string, not an ENUM: topics will change as we learn what people
-- write about, and an ENUM change is a table rebuild on every tweak. The API
-- validates the value (src/modules/contact/topics.ts).
--
-- NULL for everything that existed before, and for leads added by hand or
-- imported: those are leads, and NULL is read as one.
ALTER TABLE `contact_messages`
  ADD COLUMN `topic` VARCHAR(20) NULL AFTER `kind`;

CREATE INDEX `contact_messages_topic_status_idx` ON `contact_messages`(`topic`, `status`);
