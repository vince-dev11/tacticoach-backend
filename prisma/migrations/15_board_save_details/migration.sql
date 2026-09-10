-- Save-time details asked in the editor (required there): the age group a
-- drill is for and its difficulty. Both nullable so boards saved before this
-- existed stay valid; the editor asks for them on the next save.
ALTER TABLE `canvas_boards` ADD COLUMN `age_group` VARCHAR(16) NULL;
ALTER TABLE `canvas_boards` ADD COLUMN `difficulty` VARCHAR(16) NULL;
