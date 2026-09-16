-- Club admins.
--
-- Until now a club seat was flat: every member was a coach with their own
-- squad and nothing else. A club buying twenty seats has someone who runs the
-- place — an academy director, a head of coaching — and that person needs to
-- be able to open a coach's session and write to a player, not just watch.
--
-- Two values only. Every extra tier is another adult who can read what was
-- written to a child, so the ladder stops here.
--
-- The club OWNER is not represented in this table at all: clubs.routes only
-- ever creates a member row from an accepted invite, so an owner has no seat
-- in their own club. Ownership is read from `clubs.owner_id` and treated as
-- admin implicitly (see src/lib/club-staff.ts). Do NOT try to fix that by
-- back-filling owner rows here — `club_members.user_id` is UNIQUE, so an owner
-- who also holds a seat in a different club would collide.

ALTER TABLE `club_members`
  ADD COLUMN `role` ENUM('member', 'admin') NOT NULL DEFAULT 'member';
