import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import { feeds } from "./db/schema";
import { pollFeed } from "./pipeline/poller";
import { deduplicateAndStore } from "./pipeline/dedup";

export type PollScheduler = {
  readonly stop: () => void;
};

export function createPollScheduler(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
): PollScheduler {
  const task: ScheduledTask = cron.schedule(
    config.schedule.poll,
    async () => {
      logger.info("poll cycle starting");

      const enabledFeeds = db
        .select()
        .from(feeds)
        .where(eq(feeds.enabled, true))
        .all();

      for (const feed of enabledFeeds) {
        try {
          const pollResult = await pollFeed(feed.name, feed.url, logger);

          if (pollResult.error) {
            logger.warn(
              { feedName: feed.name, error: pollResult.error },
              "feed poll returned error, skipping dedup",
            );
            continue;
          }

          deduplicateAndStore(
            db,
            feed.id,
            feed.name,
            pollResult.items,
            logger,
          );

          db.update(feeds)
            .set({ lastPolledAt: new Date() })
            .where(eq(feeds.id, feed.id))
            .run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            { feedName: feed.name, feedUrl: feed.url, error: message },
            "unexpected error during feed processing",
          );
        }
      }

      logger.info("poll cycle complete");
    },
  );

  return {
    stop: () => {
      task.stop();
    },
  };
}
