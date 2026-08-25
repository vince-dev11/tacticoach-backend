-- Formation and squad size join the coach profile.
--
-- Formation is format-specific football: a 7v7 team plays 2-3-1 or 3-2-1, never
-- 4-3-3, and the AI must speak the right vocabulary. Squad size is the players
-- a coach actually has ("14 at 7v7" means two groups), which sizes drills so
-- everyone works. Both nullable: nothing changes for coaches who set nothing.
ALTER TABLE `users`
  ADD COLUMN `coach_formation` VARCHAR(12) NULL,
  ADD COLUMN `coach_squad_size` INTEGER NULL;
