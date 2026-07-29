DROP INDEX `articles_guid_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_feed_id_guid_unique` ON `articles` (`feed_id`,`guid`);