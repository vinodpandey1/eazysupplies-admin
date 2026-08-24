-- Store a durable, application-managed logo path for each brand.
ALTER TABLE `Brand` ADD COLUMN `image` VARCHAR(191) NULL;

UPDATE `Brand` SET `image` = '/assets/images/brands/wonderfills.png' WHERE `slug` = 'wonderfills';
UPDATE `Brand` SET `image` = '/assets/images/brands/royal-grove.png' WHERE `slug` = 'royal-grove';
UPDATE `Brand` SET `image` = '/assets/images/brands/lee-kum-kee.jpg' WHERE `slug` = 'lee-kum-kee';
UPDATE `Brand` SET `image` = '/assets/images/brands/la-puglia.png' WHERE `slug` = 'la-puglia';
UPDATE `Brand` SET `image` = '/assets/images/brands/namjai.png' WHERE `slug` = 'namjai';
