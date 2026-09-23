-- Applications to the Collaboration Programme, and the profile fields that
-- make a public directory possible.
--
-- WHY A SEPARATE TABLE from `collaborators`. An application is not a
-- collaborator with a status — it is a request from somebody who may not even
-- have an account yet, and most of them will never become one. Folding it in
-- would mean every query that asks "who are my collaborators" first has to
-- remember to exclude the people who merely asked.
--
-- WHY IT SURVIVES REJECTION. A rejected application is kept, not deleted: it
-- is the answer to "did we already say no to this club in March", and it is
-- what stops the same person being approved twice by two different people.

CREATE TABLE `collaboration_applications` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  -- Nullable: the form is public and most applicants have no account yet.
  -- Set at approval when we can match one, or when they sign up through the
  -- token below.
  `user_id` INTEGER NULL,
  `name` VARCHAR(160) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  -- What they are applying AS. Not the same as their account type: a coach at
  -- a club may apply on the club's behalf.
  `applicant_kind` ENUM('coach', 'club') NOT NULL DEFAULT 'coach',
  `organisation` VARCHAR(160) NULL,
  `location` VARCHAR(120) NULL,
  `links` VARCHAR(1000) NULL,
  -- Self-reported and unverified. Stored as their own words rather than a
  -- number, because "about 400 across two newsletters" is more useful to a
  -- reviewer than 400 with no idea where it came from.
  `audience` VARCHAR(200) NULL,
  `why` TEXT NULL,
  -- TWO consents, deliberately separate. Agreeing to be contacted is not
  -- agreeing to be published on our website, and one tick box covering both
  -- is not consent to either.
  `consent_contact` BOOLEAN NOT NULL DEFAULT false,
  `consent_listing` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
  -- The admin's note. Kept apart from `why` so the applicant's own words can
  -- never be confused with something we wrote about them.
  `review_note` VARCHAR(1000) NULL,
  `reviewed_at` DATETIME(3) NULL,
  -- Single-use, time-limited. Emailed on approval to an applicant with no
  -- account so they can create one and land straight on the agreement. It
  -- grants something, so it is a credential: hashed would be better still,
  -- but it expires in days and grants only the right to sign.
  `invite_token` VARCHAR(64) NULL,
  `invite_expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `collaboration_applications_invite_token_key`(`invite_token`),
  -- Not unique on email: somebody refused in March may reasonably apply again
  -- in September, and a unique index would make the second attempt a 500.
  INDEX `collaboration_applications_email_idx`(`email`),
  INDEX `collaboration_applications_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- ---- The public directory ---------------------------------------------------
--
-- THREE conditions to appear, all required: active, opted in, and moderated.
-- Two of them are here; `status = 'active'` is the third.
ALTER TABLE `collaborators`
  -- The collaborator's own choice, carried over from the application and
  -- changeable by them at any time. Default FALSE: nobody is published by
  -- accident.
  ADD COLUMN `listed` BOOLEAN NOT NULL DEFAULT false,
  -- An admin has looked at the photo, the words and every link. Also default
  -- FALSE, and reset to FALSE whenever the profile is edited — otherwise
  -- moderation approves one version and publishes another.
  ADD COLUMN `profile_approved` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `display_name` VARCHAR(160) NULL,
  ADD COLUMN `role_title` VARCHAR(120) NULL,
  ADD COLUMN `organisation` VARCHAR(160) NULL,
  ADD COLUMN `location` VARCHAR(120) NULL,
  ADD COLUMN `photo_key` VARCHAR(255) NULL,
  ADD COLUMN `bio` VARCHAR(600) NULL,
  ADD COLUMN `links` VARCHAR(1000) NULL,
  -- Stable, lowercase, set at first publish and never changed: a directory
  -- URL that moves is a link somebody has already shared that now 404s.
  ADD COLUMN `slug` VARCHAR(80) NULL;

CREATE UNIQUE INDEX `collaborators_slug_key` ON `collaborators`(`slug`);
-- The directory's own query, in one index. Named the way Prisma would name
-- it, so `migrate diff` against the schema stays silent.
CREATE INDEX `collaborators_status_listed_profile_approved_idx`
  ON `collaborators`(`status`, `listed`, `profile_approved`);

ALTER TABLE `collaboration_applications` ADD CONSTRAINT `collaboration_applications_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
