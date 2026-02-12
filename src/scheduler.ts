import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import { feeds } from "./db/schema";
import { pollFeed } from "./pipeline/poller";
import { deduplicateAndStore } from "./pipeline/dedup";
import { fetchPendingArticles } from "./pipeline/fetcher";
import { extractPendingArticles } from "./pipeline/extract-articles";
import { assessPendingArticles } from "./pipeline/assessor";
import { runDigestCycle } from "./digest/orchestrator";
import type { SendDigestFn } from "./digest/sender";

export type PollScheduler = {
  readonly stop: () => void;
};

export type PipelineDeps = {
  readonly model: LanguageModel | null;
};

/**
 * Creates and starts a scheduler that polls feeds on the configured cron schedule.
 * Runs the full pipeline: poll → dedup → fetch → extract → assess.
 *
 * @param db - The application database connection
 * @param config - Application configuration including schedule.poll cron expression
 * @param logger - Logger instance for recording poll events
 * @param pipeline - Optional pipeline dependencies (LLM model for assessment)
 * @returns A PollScheduler with a stop() method to halt the scheduled polling
 */
export function createPollScheduler(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
  pipeline?: PipelineDeps,
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

      // Stage 3: Fetch article content
      try {
        await fetchPendingArticles(db, config, logger);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, "fetch stage failed");
      }

      // Stage 4: Extract article content
      try {
        extractPendingArticles(db, logger);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, "extract stage failed");
      }

      // Stage 5: Assess articles against topics
      if (pipeline?.model) {
        try {
          await assessPendingArticles(db, pipeline.model, config, logger);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, "assessment stage failed");
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

/**
 * Creates and starts a scheduler that runs the digest cycle on the configured cron schedule.
 *
 * @param db - The application database connection
 * @param config - Application configuration including schedule.digest cron expression
 * @param sendDigest - Function to dispatch digest emails (dependency injection for testability)
 * @param logger - Logger instance for recording digest cycle events
 * @returns A PollScheduler with a stop() method to halt the scheduled digest cycles
 */
export function createDigestScheduler(
  db: AppDatabase,
  config: AppConfig,
  sendDigest: SendDigestFn,
  logger: Logger,
): PollScheduler {
  const task: ScheduledTask = cron.schedule(
    config.schedule.digest,
    async () => {
      try {
        await runDigestCycle(db, config, sendDigest, logger);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, "digest cycle failed unexpectedly");
      }
    },
  );

  return {
    stop: () => {
      task.stop();
    },
  };
}
