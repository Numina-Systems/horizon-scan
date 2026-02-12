# Horizon Scan Implementation Plan — Phase 2: RSS Polling & Deduplication

**Goal:** Poll RSS feeds on a schedule, extract items with metadata (including custom RSS namespaces), deduplicate against existing articles in the database, and handle feed errors gracefully.

**Architecture:** Poll loop driven by node-cron calls the poller (rss-parser) per feed, then dedup (GUID check + insert) per feed. Errors per-feed are logged and don't block other feeds. SQLite acts as the inter-stage communication layer.

**Tech Stack:** rss-parser 3.x, node-cron 4.x, vitest (testing), pino (logging), drizzle-orm (database)

**Scope:** 8 phases from original design (phases 1-8). This is phase 2.

**Codebase verified:** 2026-02-12 — Greenfield project. Phase 1 provides database schema (feeds, articles tables), config system (AppConfig with schedule.poll, feeds array), and pino logging.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC1: RSS feed polling and article storage
- **horizon-scan.AC1.1 Success:** Service polls all enabled feeds on the configured cron schedule
- **horizon-scan.AC1.2 Success:** New RSS items are stored with GUID, title, URL, published date, and RSS metadata
- **horizon-scan.AC1.3 Success:** Duplicate articles (same GUID) are skipped without error
- **horizon-scan.AC1.4 Failure:** A feed that returns an error (DNS failure, malformed XML, timeout) is logged and skipped without blocking other feeds

---

<!-- START_TASK_1 -->
### Task 1: Add phase 2 dependencies and test infrastructure

**Files:**
- Modify: `package.json` (add deps and test script)
- Create: `vitest.config.ts`
- Create: `src/test-utils/db.ts`

**Step 1: Install dependencies**

Run: `npm install rss-parser node-cron`
Run: `npm install --save-dev vitest @types/node-cron`

This adds:
- `rss-parser` — RSS/Atom feed parser with TypeScript generics support
- `node-cron` v4.x — cron-based task scheduling (rewritten in TypeScript)
- `vitest` — fast TypeScript-native test runner
- `@types/node-cron` — type definitions for node-cron

**Step 2: Add test scripts to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/db/schema.ts"],
    },
  },
});
```

**Step 4: Create src/test-utils/db.ts**

Test helper that creates an in-memory SQLite database with migrations applied. Used across all test phases.

```typescript
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../db";
import type { AppDatabase } from "../db";
import { feeds } from "../db/schema";

export function createTestDatabase(): AppDatabase {
  const db = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export async function seedTestFeed(
  db: AppDatabase,
  overrides?: Partial<typeof feeds.$inferInsert>,
): Promise<number> {
  const result = db
    .insert(feeds)
    .values({
      name: "Test Feed",
      url: "https://example.com/rss",
      extractorConfig: {
        bodySelector: "article",
        jsonLd: true,
      },
      ...overrides,
    })
    .returning({ id: feeds.id })
    .get();

  return result.id;
}
```

**Step 5: Verify**

Run: `npx vitest run`
Expected: Exits cleanly (no test files found yet, no error).

Run: `npm run build`
Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test-utils/db.ts
git commit -m "chore: add rss-parser, node-cron, and vitest test infrastructure"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: RSS pipeline types

**Files:**
- Create: `src/pipeline/types.ts`

Shared types for the RSS pipeline. These flow between poller, dedup, and later phases (fetcher, assessor).

**Step 1: Create src/pipeline/types.ts**

```typescript
export type RssItemMetadata = Readonly<Record<string, unknown>>;

export type ParsedRssItem = {
  readonly guid: string;
  readonly title: string | null;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly metadata: RssItemMetadata;
};

export type PollResult = {
  readonly feedName: string;
  readonly items: ReadonlyArray<ParsedRssItem>;
  readonly error: string | null;
};

export type DedupResult = {
  readonly feedName: string;
  readonly newCount: number;
  readonly skippedCount: number;
};
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add src/pipeline/types.ts
git commit -m "feat: add rss pipeline shared types"
```
<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: RSS poller implementation

**Verifies:** horizon-scan.AC1.1, horizon-scan.AC1.2, horizon-scan.AC1.4

**Files:**
- Create: `src/pipeline/poller.ts`

The poller fetches and parses an RSS feed URL via rss-parser, extracts standard fields plus custom namespace metadata, and returns structured `ParsedRssItem` objects. Errors are caught and returned as part of the result (never thrown).

**Implementation:**

rss-parser supports TypeScript generics `Parser<CustomFeed, CustomItem>` and a `customFields` option for extracting namespaced RSS elements. PRNewswire feeds use `prn:industry`, `prn:subject`, and `dc:contributor` namespace elements.

```typescript
import Parser from "rss-parser";
import type { Logger } from "pino";
import type { ParsedRssItem, PollResult } from "./types";

type CustomItem = {
  prnIndustry?: string;
  prnSubject?: string;
  dcContributor?: string;
};

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: [
      ["prn:industry", "prnIndustry"],
      ["prn:subject", "prnSubject"],
      ["dc:contributor", "dcContributor"],
    ],
  },
});

export async function pollFeed(
  feedName: string,
  feedUrl: string,
  logger: Logger,
): Promise<PollResult> {
  try {
    const feed = await parser.parseURL(feedUrl);

    const items: Array<ParsedRssItem> = feed.items.map((item) => {
      const guid = item.guid ?? item.link ?? "";
      const metadata: Record<string, unknown> = {};

      if (item.prnIndustry) metadata.prnIndustry = item.prnIndustry;
      if (item.prnSubject) metadata.prnSubject = item.prnSubject;
      if (item.dcContributor) metadata.dcContributor = item.dcContributor;

      return {
        guid,
        title: item.title ?? null,
        url: item.link ?? "",
        publishedAt: item.pubDate ? new Date(item.pubDate) : null,
        metadata,
      };
    });

    logger.info({ feedName, itemCount: items.length }, "feed polled successfully");
    return { feedName, items, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feedName, feedUrl, error: message }, "feed poll failed");
    return { feedName, items: [], error: message };
  }
}
```

Key behaviours:
- GUID normalisation: uses `item.guid` if present, falls back to `item.link`, then empty string
- Date parsing: `new Date(item.pubDate)` if truthy, else `null`
- Metadata: only includes custom namespace fields that are actually present (filters undefined)
- Error handling: catches all errors and returns them in `PollResult.error` — never throws (AC1.4)

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add rss feed poller with namespace metadata extraction`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: RSS poller tests

**Verifies:** horizon-scan.AC1.1, horizon-scan.AC1.2, horizon-scan.AC1.4

**Files:**
- Test: `src/pipeline/poller.test.ts` (unit)

**Testing:**
Tests must verify each AC listed above:
- **horizon-scan.AC1.1:** `pollFeed` successfully parses a valid RSS feed and returns a `PollResult` with items (mock rss-parser's `parseURL` to return fixture data)
- **horizon-scan.AC1.2:** Parsed items contain correct guid, title, url, publishedAt Date, and metadata with custom namespace fields (prnIndustry, prnSubject, dcContributor) when present in the feed
- **horizon-scan.AC1.2 (guid fallback):** When an RSS item has no `guid`, the poller uses `link` as the GUID
- **horizon-scan.AC1.4:** When rss-parser's `parseURL` throws (network error, malformed XML), `pollFeed` returns a `PollResult` with zero items and a non-null error message — does NOT throw

Mock `rss-parser` module using `vi.mock('rss-parser')`. Create a mock `parseURL` that returns fixture RSS data for success cases and throws for error cases. Use `pino({ level: 'silent' })` for the logger to suppress output during tests.

**Verification:**
Run: `npm test`
Expected: All poller tests pass.

**Commit:** `test: add rss poller unit tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Deduplication implementation

**Verifies:** horizon-scan.AC1.2, horizon-scan.AC1.3

**Files:**
- Create: `src/pipeline/dedup.ts`

The dedup module takes parsed RSS items and a feed ID, checks each item's GUID against the `articles` table, and inserts only new articles. Duplicates are silently skipped.

**Implementation:**

```typescript
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { articles } from "../db/schema";
import type { AppDatabase } from "../db";
import type { ParsedRssItem, DedupResult } from "./types";

export function deduplicateAndStore(
  db: AppDatabase,
  feedId: number,
  feedName: string,
  items: ReadonlyArray<ParsedRssItem>,
  logger: Logger,
): DedupResult {
  let newCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const existing = db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.guid, item.guid))
      .get();

    if (existing) {
      skippedCount++;
      continue;
    }

    db.insert(articles)
      .values({
        feedId,
        guid: item.guid,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        metadata: item.metadata,
        status: "pending_assessment",
      })
      .run();

    newCount++;
  }

  logger.info({ feedName, newCount, skippedCount }, "dedup complete");
  return { feedName, newCount, skippedCount };
}
```

Key behaviours:
- Synchronous operation (better-sqlite3 is sync)
- Checks GUID existence before insert to avoid unique constraint violations
- Sets `status: 'pending_assessment'` on new articles for downstream processing
- Stores metadata as JSON in the text column
- Returns counts for logging/observability

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add guid-based article deduplication`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Deduplication tests

**Verifies:** horizon-scan.AC1.2, horizon-scan.AC1.3

**Files:**
- Test: `src/pipeline/dedup.test.ts` (integration)

**Testing:**
Tests use a real in-memory SQLite database (not mocks) via `createTestDatabase()` from `src/test-utils/db.ts`. Must verify each AC:

- **horizon-scan.AC1.2:** Given new `ParsedRssItem` objects, `deduplicateAndStore` inserts them into the articles table with correct guid, title, url, publishedAt, metadata, and status of `'pending_assessment'`. Query the articles table directly to verify field values.
- **horizon-scan.AC1.3 (new items):** Given items with GUIDs not in the database, all are inserted and `newCount` matches the item count with `skippedCount` of 0.
- **horizon-scan.AC1.3 (duplicate skip):** Given items where some GUIDs already exist in the database (inserted in a prior call), those duplicates are skipped. `skippedCount` reflects the correct number, `newCount` reflects only truly new items. No errors are thrown.
- **horizon-scan.AC1.3 (all duplicates):** When all items already exist, `newCount` is 0 and `skippedCount` equals item count.

For each test: create a fresh in-memory database via `createTestDatabase()`, seed a feed via `seedTestFeed()`, run `deduplicateAndStore`, then query the articles table directly to assert row contents.

**Verification:**
Run: `npm test`
Expected: All dedup tests pass.

**Commit:** `test: add article dedup integration tests`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Scheduler implementation

**Verifies:** horizon-scan.AC1.1, horizon-scan.AC1.4

**Files:**
- Create: `src/scheduler.ts`

The scheduler uses node-cron v4 to run the poll loop on the configured cron expression. It queries enabled feeds, polls each, deduplicates results, and logs per-feed outcomes.

**Implementation:**

node-cron v4.x API:
- `cron.schedule(expression, callback)` — auto-starts the scheduled task
- Returns a `ScheduledTask` with `.stop()` method for graceful shutdown

```typescript
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
```

Key behaviours:
- Queries enabled feeds from database each cycle (config changes take effect next cycle)
- Per-feed try/catch ensures one feed failure doesn't block others (AC1.4)
- Updates `lastPolledAt` after successful poll+dedup
- If `pollFeed` returns an error, skips dedup for that feed but continues to next feed
- Returns handle with `stop()` for graceful shutdown

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add cron-based poll scheduler`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Scheduler tests

**Verifies:** horizon-scan.AC1.1, horizon-scan.AC1.4

**Files:**
- Test: `src/scheduler.test.ts` (unit)

**Testing:**
Tests must verify each AC listed above:

- **horizon-scan.AC1.1:** `createPollScheduler` registers a cron task with the configured schedule expression. When the cron callback fires, it queries enabled feeds from the database and calls `pollFeed` for each one. Verify by mocking `node-cron.schedule` to capture the callback, invoking it manually, and checking that `pollFeed` was called with each feed's name and URL.
- **horizon-scan.AC1.4 (poll error):** When `pollFeed` returns a `PollResult` with a non-null error for one feed, the scheduler continues to poll remaining feeds. Verify that `pollFeed` is called for all feeds, not just up to the failing one.
- **horizon-scan.AC1.4 (unexpected error):** When `deduplicateAndStore` throws an unexpected error for one feed, the scheduler catches it, logs the error, and continues to the next feed.
- **horizon-scan.AC1.1 (stop):** Calling `stop()` on the returned scheduler object invokes `task.stop()` on the cron task.

Mock `node-cron` module to capture the cron expression and callback. Mock `pollFeed` and `deduplicateAndStore` to control return values and verify call arguments. Use a real in-memory database (via `createTestDatabase()`) seeded with 2-3 enabled feeds to test the per-feed iteration.

**Verification:**
Run: `npm test`
Expected: All scheduler tests pass.

**Commit:** `test: add poll scheduler unit tests`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->
