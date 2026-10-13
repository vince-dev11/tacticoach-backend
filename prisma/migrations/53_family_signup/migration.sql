-- FAMILY-SIGNUP (12 Oct 2026): players and parents sign up themselves.
--
-- A child added by their parent has no email of their own, so a coach asks to
-- connect through the PARENT's email; the parent then picks which child.
ALTER TABLE `squad_players` ADD COLUMN `request_parent_id` INTEGER NULL;
CREATE INDEX `squad_players_request_parent_id_idx` ON `squad_players`(`request_parent_id`);
ALTER TABLE `squad_players` ADD CONSTRAINT `squad_players_request_parent_id_fkey` FOREIGN KEY (`request_parent_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
