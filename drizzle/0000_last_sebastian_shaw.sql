CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`guid` text NOT NULL,
	`title` text,
	`url` text NOT NULL,
	`published_at` integer,
	`raw_html` text,
	`extracted_text` text,
	`metadata` text,
	`status` text DEFAULT 'pending_assessment' NOT NULL,
	`fetch_retry_count` integer DEFAULT 0 NOT NULL,
	`assessment_retry_count` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_guid_unique` ON `articles` (`guid`);--> statement-breakpoint
CREATE INDEX `articles_feed_id_idx` ON `articles` (`feed_id`);--> statement-breakpoint
CREATE INDEX `articles_status_idx` ON `articles` (`status`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`relevant` integer NOT NULL,
	`summary` text,
	`tags` text NOT NULL,
	`model_used` text NOT NULL,
	`provider` text NOT NULL,
	`assessed_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assessments_article_id_idx` ON `assessments` (`article_id`);--> statement-breakpoint
CREATE INDEX `assessments_topic_id_idx` ON `assessments` (`topic_id`);--> statement-breakpoint
CREATE TABLE `digests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sent_at` integer NOT NULL,
	`article_count` integer NOT NULL,
	`recipient` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`extractor_config` text NOT NULL,
	`poll_interval_minutes` integer DEFAULT 15 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_polled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
