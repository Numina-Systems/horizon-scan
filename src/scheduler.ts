import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { LanguageModel, EmbeddingModel } from "ai";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import { feeds } from "./db/schema";
import { createSingleFlight } from "./concurrency/single-flight";
import { pollFeed } from "./pipeline/poller";
import { deduplicateAndStore } from "./pipeline/dedup";
import { processPendingDedup, fallbackPendingDedup } from "./pipeline/embedding-dedup";
import { fetchPendingArticles } from "./pipeline/fetcher";
import { extractPendingArticles } from "./pipeline/extract-articles";
import { assessPendingArticles } from "./pipeline/assessor";
import { runDigestCycle } from "./digest/orchestrator";
import type { SendDigestFn } from "./digest/sender";

// ---------------------------------------------------------------------------
// Module-level single-flight locks (PRIVATE — not exported, not injectable)
// ---------------------------------------------------------------------------
// These are intentionally module-private singletons. Both the scheduler cron
// callbacks and the triggerPollCycle function share the same lock instance.
// Node.js single-threaded execution makes synchronous tryAcquire() race-free.
//
// There is NO resetSingleFlight(), NO lock parameter, and NO way to inject or
// override these locks from outside the module. Tests use vi.resetModules() to
// get fresh module instances with fresh singletons.
//
// Task D (NSY-5) will add Promise tracking inside the private wrappers below.
// ---------------------------------------------------------------------------

const pollFlight = createSingleFlight();
const digestFlight = createSingleFlight();

// ---------------------------------------------------------------------------
// PRIVATE lock wrapper functions (F5)
// ---------------------------------------------------------------------------
// withPollLock and withDigestLock centralize the try-acquire/try-finally/release
// pattern. They are NOT exported. Task D (NSY-5) has minimal edit points here —
// it only needs to add Promise tracking inside these two functions.
//
// --- TASK D EDIT POINT (NSY-5) ---
// Task D: add Promise tracking here. Set activePollPromise before calling fn,
// clear it in the finally block. Export drainPoll() that awaits activePollPromise.
// ---------------------------------------------------------------------------

/**
 * PRIVATE: Wraps a function in the poll single-flight lock.
 * Returns { triggered: false } if the lock is already held, otherwise runs the
 * function and returns { triggered: true }. The lock is ALWAYS released via
 * finally, even on error.
 */
async function withPollLock<T extends () => Promise<void>>(
  fn: T,
  logger: Logger,
): Promise<{ triggered: boolean; reason?: string }> {
  if (!pollFlight.tryAcquire()) {
    logger.warn("poll cycle skipped — another poll already running");
    return { triggered: false, reason: "already-running" };
  }
  try {
    await fn();
    return { triggered: true };
  } finally {
    pollFlight.release();
  }
}

/**
 * PRIVATE: Wraps a function in the digest single-flight lock.
 * Returns false if the lock is already held, otherwise runs the function and
 * returns true. The lock is ALWAYS released via finally, even on error.
 *
 * --- TASK D EDIT POINT (NSY-5) ---
 * Task D: add Promise tracking here. Same pattern as withPollLock.
 */
async function withDigestLock<T extends () => Promise<void>>(
  fn: T,
  logger: Logger,
): Promise<boolean> {
  if (!digestFlight.tryAcquire()) {
    logger.warn("digest cycle skipped — another digest already running");
    return false;
  }
  try {
    await fn();
    return true;
  } finally {
    digestFlight.release();
  }
}

export type PollScheduler = {
  readonly stop: () => void;
};

// EmbeddingModel is a union type in ai v4+ (not generic)
export type PipelineDeps = {
  readonly model: LanguageModel | null;
  readonly embeddingModel: EmbeddingModel | null;
};

/**
 * Runs a single poll cycle: poll → dedup → embedding-dedup → fetch → extract → assess.
 * PRIVATE — not exported. Use triggerPollCycle as the sole entry point for
 * triggering poll cycles from outside this module.
 */
async function runPollCycle(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
  pipeline?: PipelineDeps,
): Promise<void> {
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

  if (pipeline?.embeddingModel) {
    try {
      await processPendingDedup(db, pipeline.embeddingModel, config, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "embedding dedup stage failed");
    }
  } else {
    try {
      fallbackPendingDedup(db, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "embedding dedup fallback failed");
    }
  }

  try {
    await fetchPendingArticles(db, config, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "fetch stage failed");
  }

  try {
    extractPendingArticles(db, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "extract stage failed");
  }

  if (pipeline?.model) {
    try {
      await assessPendingArticles(db, pipeline.model, config, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "assessment stage failed");
    }
  }

  logger.info("poll cycle complete");
}

/**
 * Attempts to trigger a poll cycle. Returns { triggered: false } if a poll
 * is already running (single-flight protection).
 *
 * Uses the private withPollLock wrapper, which uses the module-level pollFlight
 * singleton. There is no lock parameter — the singleton is the only lock.
 */
export async function triggerPollCycle(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
  pipeline?: PipelineDeps,
): Promise<{ triggered: boolean; reason?: string }> {
  return withPollLock(
    () => runPollCycle(db, config, logger, pipeline),
    logger,
  );
}

/**
 * Creates and starts a scheduler that polls feeds on the configured cron schedule.
 * Runs the full pipeline: poll → dedup → embedding-dedup → fetch → extract → assess.
 *
 * @param db - The application database connection
 * @param config - Application configuration including schedule.poll cron expression
 * @param logger - Logger instance for recording poll events
 * @param pipeline - Optional pipeline dependencies (LLM model for assessment, embedding model for dedup)
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
      await withPollLock(
        async () => {
          try {
            await runPollCycle(db, config, logger, pipeline);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ error: message }, "poll cycle failed unexpectedly");
          }
        },
        logger,
      );
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
      await withDigestLock(
        async () => {
          try {
            await runDigestCycle(db, config, sendDigest, logger);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ error: message }, "digest cycle failed unexpectedly");
          }
        },
        logger,
      );
    },
  );

  return {
    stop: () => {
      task.stop();
    },
  };
}
