-- A signature and a printed name, so an acceptance is a signed document
-- rather than a tick in a box.
--
-- `signed_at` already carries the date and time; nothing new is needed for
-- that, and it is set by the database rather than the client so it cannot be
-- back-dated by whoever is signing.

-- The name as the signer TYPED it, which is not necessarily their account
-- name. A club secretary signing on behalf of the club, or somebody whose
-- account says "Vince" but who signs "Vincent Okafor", both need the name they
-- chose to put on the document to be the name the document shows.
ALTER TABLE `agreement_acceptances`
  ADD COLUMN `signer_name` VARCHAR(160) NULL AFTER `version`;

-- The signature image, as a PNG data URL.
--
-- In the database rather than S3, deliberately. It is a few kilobytes, it is
-- read roughly never, and it must be retrievable for as long as the agreement
-- matters — which is exactly the profile that makes object storage a liability
-- rather than a benefit. It also means a signature cannot be lost to a bucket
-- misconfiguration, and S3 on this deployment is currently failing outright
-- with a placeholder access key.
--
-- MEDIUMTEXT (16 MB) with a much smaller cap enforced in the route: a
-- signature that needs megabytes is not a signature.
ALTER TABLE `agreement_acceptances`
  ADD COLUMN `signature` MEDIUMTEXT NULL AFTER `signer_name`;

-- Both NULL-able because rows written before this migration have neither, and
-- an acceptance already given is still an acceptance. New signings require
-- both — enforced in the route, where a useful error message can be returned,
-- rather than by a NOT NULL that would only ever produce a 500.
