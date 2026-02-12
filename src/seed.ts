import type { Logger } from "pino";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import { feeds, topics } from "./db/schema";

/**
 * Seeds feeds and topics from configuration into the database.
 *
 * Seeds are idempotent: if feeds or topics already exist in their respective tables,
 * seeding for that table is skipped. This allows the database to be the source of truth
 * after the initial run.
 *
 * @param db - The database instance to seed into.
 * @param config - The application configuration containing feeds and topics.
 * @param logger - The logger instance for structured logging.
 *
 * Functional Core — performs pure database operations (idempotent and side-effect-free
 * in terms of business logic; side effects are confined to logging and DB writes).
 */
export function seedDatabase(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
): void {
  const existingFeeds = db.select({ id: feeds.id }).from(feeds).all();

  if (existingFeeds.length === 0) {
    logger.info(
      { feedCount: config.feeds.length },
      "seeding feeds from config",
    );

    for (const feed of config.feeds) {
      db.insert(feeds)
        .values({
          name: feed.name,
          url: feed.url,
          extractorConfig: feed.extractorConfig,
          pollIntervalMinutes: feed.pollIntervalMinutes,
          enabled: feed.enabled,
        })
        .run();
    }
  } else {
    logger.info(
      { existingCount: existingFeeds.length },
      "feeds already exist, skipping seed",
    );
  }

  const existingTopics = db.select({ id: topics.id }).from(topics).all();

  if (existingTopics.length === 0) {
    logger.info(
      { topicCount: config.topics.length },
      "seeding topics from config",
    );

    for (const topic of config.topics) {
      db.insert(topics)
        .values({
          name: topic.name,
          description: topic.description,
          enabled: topic.enabled,
        })
        .run();
    }
  } else {
    logger.info(
      { existingCount: existingTopics.length },
      "topics already exist, skipping seed",
    );
  }
}
