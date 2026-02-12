# Horizon Scan Implementation Plan — Phase 7: Service Lifecycle & Observability

**Goal:** Wire all pipeline components into a runnable service with structured logging, config-driven startup with database seeding, and graceful shutdown.

**Architecture:** The entry point (`src/index.ts`) loads config, creates the database, initialises the logger, seeds feeds/topics on first run, starts both cron schedulers (poll + digest), starts the API server, and registers signal handlers for graceful shutdown. Dependencies flow top-down: config → db → logger → seed → schedulers + API server.

**Tech Stack:** pino 10.x (logging), node-cron 4.x (scheduling), express 5.x (API), drizzle-orm (database), better-sqlite3 (SQLite driver)

**Scope:** 8 phases from original design (phases 1-8). This is phase 7.

**Codebase verified:** 2026-02-12 — Greenfield project. All prior phases (1-6) define the components this phase wires together: database (`src/db/index.ts`), config (`src/config/index.ts`), scheduler (`src/scheduler.ts` with `createPollScheduler` and `createDigestScheduler`), API server (`src/api/server.ts` with `createApiServer`), pipeline modules, and digest modules.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC4: Configuration
- **horizon-scan.AC4.1 Success:** Service starts with valid env vars + config.yaml and seeds feeds/topics into database on first run
- **horizon-scan.AC4.2 Failure:** Invalid configuration (missing required fields, bad cron expression, unknown provider) causes startup failure with clear error message

### horizon-scan.AC6: Deployment and operations
- **horizon-scan.AC6.1 Success:** Service shuts down gracefully on SIGTERM/SIGINT — in-flight work completes, DB connection closes cleanly
- **horizon-scan.AC6.2 Success:** Structured JSON logs via pino include feed poll results, fetch outcomes, assessment results, and digest send status

---

<!-- START_TASK_1 -->
### Task 1: Logger module

**Files:**
- Create: `src/logger.ts`

Pino logger configured for structured JSON output. All pipeline components receive a logger instance via dependency injection, so this module creates the root logger.

**Implementation:**

```typescript
import pino from "pino";

export function createLogger(level?: string): pino.Logger {
  return pino({
    level: level ?? process.env.LOG_LEVEL ?? "info",
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

Key behaviours:
- Returns `level` as string label (not numeric) for readability
- ISO 8601 timestamps for structured log aggregation
- Level configurable via `LOG_LEVEL` env var, defaults to `info`
- No transport configuration — stdout JSON by default (container-friendly)

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add pino logger module`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Database seeding from config

**Verifies:** horizon-scan.AC4.1

**Files:**
- Create: `src/seed.ts`

Seeds feeds and topics from the config file into the database on first run. Only inserts if the tables are empty — the database is the source of truth after first run.

**Implementation:**

```typescript
import type { Logger } from "pino";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import { feeds, topics } from "./db/schema";

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
```

Key behaviours:
- Checks if feeds table is empty before seeding feeds (idempotent)
- Checks if topics table is empty before seeding topics (independently)
- Maps config feed objects to database row values including `extractorConfig` JSON
- Synchronous operations (better-sqlite3 is sync)
- Logs seed counts or skip reason

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add database seeding from config`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Database seeding tests

**Verifies:** horizon-scan.AC4.1

**Files:**
- Test: `src/seed.test.ts` (integration)

**Testing:**

Tests use a real in-memory SQLite database via `createTestDatabase()` from `src/test-utils/db.ts`.

- **horizon-scan.AC4.1 (first run seeds feeds):** Given an empty database and config with 2 feeds, `seedDatabase` inserts 2 rows into the feeds table. Query feeds table to verify name, url, extractorConfig, pollIntervalMinutes, and enabled match the config values.
- **horizon-scan.AC4.1 (first run seeds topics):** Given an empty database and config with 2 topics, `seedDatabase` inserts 2 rows into the topics table. Query topics table to verify name and description match config values.
- **horizon-scan.AC4.1 (idempotent — skips when data exists):** Seed once. Call `seedDatabase` again with different config. Verify feed and topic counts are unchanged — second call does not insert duplicates or overwrite existing data.
- **horizon-scan.AC4.1 (independent seeding):** Seed feeds into database manually, leave topics empty. Call `seedDatabase`. Verify feeds are NOT re-seeded but topics ARE seeded.

Create a helper function in the test file to build a minimal `AppConfig` for seeding tests. Use `pino({ level: 'silent' })` to suppress log output.

**Verification:**
Run: `npm test`
Expected: All seed tests pass.

**Commit:** `test: add database seeding integration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Lifecycle manager (graceful shutdown)

**Verifies:** horizon-scan.AC6.1

**Files:**
- Create: `src/lifecycle.ts`

Handles SIGTERM and SIGINT signals. Stops cron schedulers, closes the database connection, then exits.

**Implementation:**

```typescript
import type { Logger } from "pino";

export type Stoppable = {
  readonly stop: () => void;
};

export type ShutdownDeps = {
  readonly schedulers: ReadonlyArray<Stoppable>;
  readonly closeDb: () => void;
  readonly logger: Logger;
};

export function registerShutdownHandlers(deps: ShutdownDeps): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    deps.logger.info({ signal }, "shutdown signal received");

    for (const scheduler of deps.schedulers) {
      try {
        scheduler.stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error({ error: message }, "error stopping scheduler");
      }
    }

    try {
      deps.closeDb();
      deps.logger.info("database connection closed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error({ error: message }, "error closing database");
    }

    deps.logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

Key behaviours:
- Guard against double-shutdown (re-entrant signal delivery)
- Stops all schedulers before closing DB (in-flight cron callbacks may need DB)
- Wraps each cleanup step in try/catch to ensure all steps run
- Logs each phase of shutdown for observability
- Calls `process.exit(0)` after cleanup

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add graceful shutdown lifecycle manager`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Lifecycle manager tests

**Verifies:** horizon-scan.AC6.1

**Files:**
- Test: `src/lifecycle.test.ts` (unit)

**Testing:**

- **horizon-scan.AC6.1 (SIGTERM calls shutdown):** Register handlers with mock deps. Emit `SIGTERM` on `process`. Verify all scheduler `.stop()` methods were called, `closeDb` was called, and `process.exit` was called with 0. Mock `process.exit` via `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); })` to prevent actual exit.
- **horizon-scan.AC6.1 (SIGINT calls shutdown):** Same as above but emit `SIGINT`.
- **horizon-scan.AC6.1 (multiple schedulers stopped):** Register with 3 mock schedulers. Emit signal. Verify all 3 `.stop()` methods called.
- **horizon-scan.AC6.1 (double signal ignored):** Emit `SIGTERM` twice. Verify `closeDb` called only once (re-entrant guard works).
- **horizon-scan.AC6.1 (scheduler error doesn't prevent db close):** One scheduler's `.stop()` throws. Verify `closeDb` is still called despite the error.

Use `pino({ level: 'silent' })` for logger. Clean up process listeners after each test to avoid interference between tests.

**Verification:**
Run: `npm test`
Expected: All lifecycle tests pass.

**Commit:** `test: add graceful shutdown lifecycle tests`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Main entry point

**Verifies:** horizon-scan.AC4.1, horizon-scan.AC4.2, horizon-scan.AC6.1, horizon-scan.AC6.2

**Files:**
- Modify: `src/db/index.ts` (add `close()` function to return value)
- Modify: `src/scheduler.ts` (extend poll scheduler to run full pipeline: poll → dedup → fetch → extract → assess)
- Create: `src/index.ts`

The main entry point wires all components together: loads config, creates database, runs migrations, seeds data, starts the full pipeline scheduler (poll → dedup → fetch → extract → assess), starts digest scheduler, starts API server, and registers shutdown handlers.

**Step 1: Modify `src/db/index.ts` to expose `close()`**

The Phase 1 `createDatabase()` returns only the Drizzle instance. Modify it to also return a `close()` function so the shutdown handler can cleanly close the underlying SQLite connection.

Change `src/db/index.ts` to:

```typescript
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDatabase(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return { db, close: () => sqlite.close() };
}

export type DatabaseResult = ReturnType<typeof createDatabase>;
export type AppDatabase = DatabaseResult["db"];
```

All existing code that uses `AppDatabase` continues to work unchanged — it still refers to the Drizzle instance. Only the entry point destructures `{ db, close }`.

**Step 2: Extend `src/scheduler.ts` to run full pipeline**

The Phase 2 `createPollScheduler` only runs poll + dedup. The design specifies the poll loop as 5 stages: poll → dedup → fetch → extract → assess. Extend the scheduler to accept and call the remaining pipeline stages after dedup:

Add imports and modify `createPollScheduler` to accept optional pipeline functions:

```typescript
import { fetchPendingArticles } from "./pipeline/fetcher";
import { extractPendingArticles } from "./pipeline/extract-articles";
import { assessPendingArticles } from "./pipeline/assessor";
import type { LanguageModel } from "ai";

export type PipelineDeps = {
  readonly model: LanguageModel | null;
};

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

      // Stage 1-2: Poll feeds and deduplicate (existing code)
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

          deduplicateAndStore(db, feed.id, feed.name, pollResult.items, logger);

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

      // Stage 3: Fetch and extract article content
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

      // Stage 4: Assess articles against topics
      if (pipeline?.model) {
        try {
          await assessPendingArticles(db, config, pipeline.model, logger);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, "assessment stage failed");
        }
      }

      logger.info("poll cycle complete");
    },
  );

  return { stop: () => task.stop() };
}
```

Key changes:
- Optional `PipelineDeps` parameter for the LLM model (null if no provider configured)
- After poll+dedup, runs fetch → extract → assess in sequence
- Each stage wrapped in try/catch — a failure in fetch doesn't block extract/assess of previously fetched articles
- Assessment only runs if a model is provided (avoids crash when LLM not configured)
- Phase 2 tests continue to work because `pipeline` parameter is optional

**Step 3: Create `src/index.ts`**

```typescript
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createLogger } from "./logger";
import { loadConfig } from "./config";
import { createDatabase } from "./db";
import { createLlmClient } from "./llm/client";
import { seedDatabase } from "./seed";
import { createPollScheduler } from "./scheduler";
import { createDigestScheduler } from "./scheduler";
import { createMailgunSender } from "./digest/sender";
import { createApiServer } from "./api/server";
import { registerShutdownHandlers } from "./lifecycle";

const CONFIG_PATH = process.env.CONFIG_PATH ?? "./config.yaml";
const DATABASE_URL = process.env.DATABASE_URL ?? "./data/horizon-scan.db";
const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  const logger = createLogger();

  logger.info("horizon-scan starting");

  let config;
  try {
    config = loadConfig(resolve(CONFIG_PATH));
  } catch (err) {
    logger.fatal({ error: err instanceof Error ? err.message : String(err) }, "configuration error");
    process.exit(1);
  }

  logger.info(
    { provider: config.llm.provider, model: config.llm.model },
    "config loaded",
  );

  const { db, close: closeDb } = createDatabase(resolve(DATABASE_URL));

  migrate(db, { migrationsFolder: resolve("./drizzle") });
  logger.info("database migrations applied");

  seedDatabase(db, config, logger);

  let model = null;
  try {
    model = createLlmClient(config);
    logger.info({ provider: config.llm.provider, model: config.llm.model }, "llm client initialised");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ error: message }, "llm client init failed, assessment disabled");
  }

  const pollScheduler = createPollScheduler(db, config, logger, { model });
  logger.info({ schedule: config.schedule.poll }, "poll scheduler started");

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;

  let digestScheduler;
  if (apiKey && domain) {
    const sendDigest = createMailgunSender(apiKey, domain);
    digestScheduler = createDigestScheduler(db, config, sendDigest, logger);
    logger.info({ schedule: config.schedule.digest }, "digest scheduler started");
  } else {
    logger.warn("MAILGUN_API_KEY or MAILGUN_DOMAIN not set, digest scheduler disabled");
  }

  const schedulers = digestScheduler
    ? [pollScheduler, digestScheduler]
    : [pollScheduler];

  registerShutdownHandlers({ schedulers, closeDb, logger });

  const app = createApiServer({ db, config, logger });
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "api server listening");
  });
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
```

Key behaviours:
- Config validation failure logs `fatal` and exits with code 1 (AC4.2)
- Migrations run on every startup to ensure schema is current
- Seeds only on first run (empty tables check in `seedDatabase`)
- Digest scheduler only starts if Mailgun credentials are present (graceful degradation)
- All schedulers passed to shutdown handler for clean teardown (AC6.1)
- Structured JSON logging throughout via pino (AC6.2)
- API server binds to configurable PORT (default 3000)

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add main entry point with service lifecycle`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Entry point and integration tests

**Verifies:** horizon-scan.AC4.1, horizon-scan.AC4.2, horizon-scan.AC6.2

**Files:**
- Test: `src/index.test.ts` (integration)

**Testing:**

These tests verify the service startup flow. They do NOT start the full server — instead they test the individual wiring logic.

- **horizon-scan.AC4.2 (invalid config — missing required fields):** Call `loadConfig` with a YAML file missing the `llm` section. Verify it throws with a message containing `"invalid configuration"` and the specific path (e.g., `llm.provider`).
- **horizon-scan.AC4.2 (invalid config — unknown provider):** Call `loadConfig` with `llm.provider: "invalid_provider"`. Verify it throws with a Zod validation error listing the invalid enum value.
- **horizon-scan.AC4.2 (invalid config — bad cron expression):** This is validated at runtime by `node-cron.schedule()`. Verify that `cron.schedule("not a cron", callback)` throws. (This is a sanity check for the runtime guard, not a unit test of node-cron.)
- **horizon-scan.AC4.1 (startup seeds database):** Create an in-memory database, load a valid config, call `seedDatabase`. Verify feeds and topics tables contain the expected rows matching config. (This overlaps with Task 3 but verifies the wiring.)
- **horizon-scan.AC6.2 (structured log output):** Create logger with `createLogger('info')`. Capture pino output by passing a writable stream. Log a message. Verify JSON output contains `level`, `time` (ISO format), and `msg` fields.

For config validation tests, create temporary YAML files in a temp directory using `node:fs` and `node:os`. Clean up after each test.

**Verification:**
Run: `npm test`
Expected: All entry point tests pass.

**Commit:** `test: add service startup and config validation tests`
<!-- END_TASK_7 -->
