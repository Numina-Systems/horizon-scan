PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`guid` text NOT NULL,
	`title` text,
	`url` text NOT NULL,
	`published_at` integer,
	`raw_html` text,
	`extracted_text` text,
	`metadata` text,
	`embedding` text,
	`status` text DEFAULT 'pending_dedup' NOT NULL,
	`fetch_retry_count` integer DEFAULT 0 NOT NULL,
	`assessment_retry_count` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_articles`("id", "feed_id", "guid", "title", "url", "published_at", "raw_html", "extracted_text", "metadata", "embedding", "status", "fetch_retry_count", "assessment_retry_count", "fetched_at", "created_at") SELECT "id", "feed_id", "guid", "title", "url", "published_at", "raw_html", "extracted_text", "metadata", NULL, CASE WHEN "status" = 'pending_assessment' THEN 'pending_dedup' ELSE "status" END, "fetch_retry_count", "assessment_retry_count", "fetched_at", "created_at" FROM `articles`;--> statement-breakpoint
DROP TABLE `articles`;--> statement-breakpoint
ALTER TABLE `__new_articles` RENAME TO `articles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_guid_unique` ON `articles` (`guid`);--> statement-breakpoint
CREATE INDEX `articles_feed_id_idx` ON `articles` (`feed_id`);--> statement-breakpoint
CREATE INDEX `articles_status_idx` ON `articles` (`status`);