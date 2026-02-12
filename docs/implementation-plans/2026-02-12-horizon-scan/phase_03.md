# Horizon Scan Implementation Plan — Phase 3: Article Content Extraction

**Goal:** Fetch full article content from URLs using native fetch with concurrency limiting and per-domain delay, extract body text and metadata using Cheerio with per-feed CSS selectors, and parse JSON-LD structured data when available.

**Architecture:** The fetcher handles HTTP retrieval with rate limiting (p-limit for concurrency, per-domain delay). The extractor uses Cheerio to extract body text via configurable CSS selectors and parses JSON-LD `<script>` tags. Failed fetches record retry counts on the article row for subsequent retry cycles.

**Tech Stack:** cheerio 1.x, p-limit 5.x (last CJS-compatible), native Node.js fetch, vitest (testing)

**Design deviation:** The design lists `src/pipeline/extractors/prnewswire.ts` as a component for PRNewswire default extractor config. This file is intentionally omitted — extractor configurations are stored per-feed in the database `extractorConfig` JSON column (seeded from `config.yaml` in Phase 7). This data-driven approach means new feed sources are added via config changes, not code changes, which better serves the design's stated goal of "enabling new sources without code changes."

**Scope:** 8 phases from original design (phases 1-8). This is phase 3.

**Codebase verified:** 2026-02-12 — Greenfield project. Phase 1 provides database schema (articles table with rawHtml, extractedText, metadata, status, fetchRetryCount, fetchedAt fields; feeds table with extractorConfig JSON column). Phase 2 provides pipeline types, poller, dedup, and vitest test infrastructure.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC1: RSS feed polling and article storage
- **horizon-scan.AC1.5 Success:** Full article content is fetched from article URL and extracted using configured Cheerio selectors
- **horizon-scan.AC1.6 Success:** JSON-LD structured data is parsed when available and merged with RSS metadata
- **horizon-scan.AC1.7 Failure:** Article fetch failure (403, timeout, parse error) records the article with `status: 'failed'` and retries up to 3 times on subsequent cycles

---

<!-- START_TASK_1 -->
### Task 1: Add phase 3 dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run: `npm install cheerio p-limit@^5.0.0`

This adds:
- `cheerio` 1.x — HTML parser with jQuery-like CSS selectors, fully typed for TypeScript
- `p-limit` 5.x — concurrency limiter for Promise-returning functions (pinned to v5, the last CJS-compatible version; v6+ is ESM-only and incompatible with this project's CommonJS module system)

**Step 2: Verify**

Run: `npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cheerio and p-limit dependencies"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Article fetcher implementation

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.7

**Files:**
- Create: `src/pipeline/fetcher.ts`

The fetcher retrieves article HTML from URLs with concurrency limiting and per-domain delay. Uses native Node.js `fetch()` with `AbortSignal.timeout()` for request timeouts.

**Implementation:**

```typescript
import type { Logger } from "pino";

type FetchResult =
  | { success: true; html: string; url: string }
  | { success: false; error: string; url: string };

export async function fetchArticle(
  url: string,
  timeoutMs: number,
  logger: Logger,
): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "HorizonScan/1.0 (RSS article fetcher)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        url,
      };
    }

    const html = await response.text();
    return { success: true, html, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, error: message }, "article fetch failed");
    return { success: false, error: message, url };
  }
}
```

The concurrency-limited batch fetcher processes pending articles from the database with configurable concurrency and per-domain delay:

```typescript
import { eq, and, lt } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { articles, feeds } from "../db/schema";
import type { AppConfig } from "../config";

const MAX_RETRIES = 3;

export async function fetchPendingArticles(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const pending = db
    .select({
      id: articles.id,
      url: articles.url,
      feedId: articles.feedId,
      fetchRetryCount: articles.fetchRetryCount,
    })
    .from(articles)
    .where(
      and(
        eq(articles.status, "pending_assessment"),
        eq(articles.rawHtml, null as unknown as string),
        lt(articles.fetchRetryCount, MAX_RETRIES),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending fetch");
    return;
  }

  const pLimit = require("p-limit") as typeof import("p-limit")["default"];
  const limit = pLimit(config.extraction.maxConcurrency);
  const delayMs = config.extraction.perDomainDelayMs;

  const domainLastFetch = new Map<string, number>();

  const tasks = pending.map((article) =>
    limit(async () => {
      const domain = new URL(article.url).hostname;
      const lastFetch = domainLastFetch.get(domain) ?? 0;
      const elapsed = Date.now() - lastFetch;

      if (elapsed < delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs - elapsed),
        );
      }

      domainLastFetch.set(domain, Date.now());

      const result = await fetchArticle(article.url, 15000, logger);

      if (result.success) {
        db.update(articles)
          .set({
            rawHtml: result.html,
            fetchedAt: new Date(),
          })
          .where(eq(articles.id, article.id))
          .run();
      } else {
        const newRetryCount = article.fetchRetryCount + 1;
        db.update(articles)
          .set({
            fetchRetryCount: newRetryCount,
            status: newRetryCount >= MAX_RETRIES ? "failed" : "pending_assessment",
          })
          .where(eq(articles.id, article.id))
          .run();
      }
    }),
  );

  await Promise.allSettled(tasks);
  logger.info({ totalFetched: pending.length }, "article fetch cycle complete");
}
```

Key behaviours:
- Concurrency controlled by `config.extraction.maxConcurrency` (default 2)
- Per-domain delay via `config.extraction.perDomainDelayMs` (default 1000ms)
- 15-second fetch timeout via `AbortSignal.timeout()`
- On success: stores raw HTML and sets `fetchedAt` timestamp
- On failure: increments `fetchRetryCount`; marks `status: 'failed'` when retry count reaches 3 (AC1.7)
- Articles without `rawHtml` and below retry cap are selected for fetching

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add article fetcher with concurrency limiting and retry`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Article fetcher tests

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.7

**Files:**
- Test: `src/pipeline/fetcher.test.ts` (unit + integration)

**Testing:**
Tests must verify each AC listed:

- **horizon-scan.AC1.5 (single fetch success):** `fetchArticle` returns `{ success: true, html }` when the URL responds with 200 and HTML content. Mock global `fetch` to return a successful Response.
- **horizon-scan.AC1.5 (HTTP error):** `fetchArticle` returns `{ success: false, error }` when server responds with 403/404/500. Verify the error message includes the HTTP status code.
- **horizon-scan.AC1.5 (timeout):** `fetchArticle` returns `{ success: false, error }` when the request exceeds the timeout. Mock fetch to never resolve (or delay beyond timeout).
- **horizon-scan.AC1.7 (retry counting):** `fetchPendingArticles` increments `fetchRetryCount` on the article row when a fetch fails. Use in-memory database, seed a feed and article, mock fetch to fail, run `fetchPendingArticles`, then query the article to verify `fetchRetryCount` incremented.
- **horizon-scan.AC1.7 (max retries):** When an article has `fetchRetryCount` of 2 and the next fetch fails, the article's status is set to `'failed'`. Verify with direct database query.
- **horizon-scan.AC1.7 (skip exhausted):** Articles with `fetchRetryCount >= 3` are not selected for fetching. Seed an article with `fetchRetryCount: 3`, run `fetchPendingArticles`, verify fetch was not called for that article.

Use `vi.stubGlobal('fetch', mockFetch)` to mock the native fetch API. For integration tests involving the database, use `createTestDatabase()` and `seedTestFeed()`.

**Verification:**
Run: `npm test`
Expected: All fetcher tests pass.

**Commit:** `test: add article fetcher unit and integration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Content extractor implementation

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.6

**Files:**
- Create: `src/pipeline/extractor.ts`

The extractor takes raw HTML and an `ExtractorConfig` (from the feed's config), uses Cheerio to extract body text via CSS selectors, and optionally parses JSON-LD structured data.

**Implementation:**

```typescript
import * as cheerio from "cheerio";
import type { Logger } from "pino";
import type { ExtractorConfig } from "../db/schema";

export type ExtractionResult = {
  readonly extractedText: string;
  readonly jsonLdData: ReadonlyArray<Record<string, unknown>>;
};

export function extractContent(
  html: string,
  config: Readonly<ExtractorConfig>,
  logger: Logger,
): ExtractionResult {
  const $ = cheerio.load(html);

  // Extract body text using configured CSS selector
  const bodyElements = $(config.bodySelector);
  const extractedText = bodyElements
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0)
    .join("\n\n");

  // Extract JSON-LD structured data
  const jsonLdData: Array<Record<string, unknown>> = [];

  if (config.jsonLd) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) {
            jsonLdData.push(parsed as Record<string, unknown>);
          }
        }
      } catch {
        logger.debug("failed to parse JSON-LD script tag");
      }
    });
  }

  // Extract metadata from configured selectors
  if (config.metadataSelectors) {
    for (const [key, selector] of Object.entries(config.metadataSelectors)) {
      const value = $(selector).text().trim();
      if (value) {
        // Metadata selectors are merged into JSON-LD data array as a separate object
        jsonLdData.push({ _source: "metadataSelector", [key]: value });
      }
    }
  }

  return { extractedText, jsonLdData };
}
```

Key behaviours:
- Uses `config.bodySelector` CSS selector to find article body elements
- Joins text from all matching elements with double newline
- Parses all `<script type="application/ld+json">` tags when `config.jsonLd` is true
- Uses `.html()` (not `.text()`) to get script tag content — critical Cheerio gotcha
- Silently skips malformed JSON-LD (logs at debug level)
- Optional `metadataSelectors` extract additional page elements

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add cheerio-based content extractor with json-ld parsing`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Content extractor tests

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.6

**Files:**
- Test: `src/pipeline/extractor.test.ts` (unit)

**Testing:**
Tests must verify each AC listed:

- **horizon-scan.AC1.5 (body extraction):** Given HTML with elements matching the configured `bodySelector`, `extractContent` returns `extractedText` containing the text content of those elements joined by double newlines.
- **horizon-scan.AC1.5 (empty selector match):** When the CSS selector matches no elements, `extractedText` is an empty string.
- **horizon-scan.AC1.6 (JSON-LD parsing):** Given HTML containing `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test"}</script>`, `extractContent` with `jsonLd: true` returns the parsed object in `jsonLdData`.
- **horizon-scan.AC1.6 (multiple JSON-LD):** When HTML contains multiple JSON-LD script tags, all are parsed and returned in the array.
- **horizon-scan.AC1.6 (malformed JSON-LD):** When a JSON-LD script tag contains invalid JSON, it is silently skipped (no error thrown, other valid JSON-LD tags still parsed).
- **horizon-scan.AC1.6 (JSON-LD disabled):** When `config.jsonLd` is false, JSON-LD script tags are not parsed even if present.
- **horizon-scan.AC1.5 (metadata selectors):** When `config.metadataSelectors` is provided, the extractor extracts text from each selector and includes it in the results.

Construct HTML fixture strings directly in tests. No HTTP mocking needed — extractor operates on raw HTML strings.

**Verification:**
Run: `npm test`
Expected: All extractor tests pass.

**Commit:** `test: add content extractor unit tests`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->
<!-- START_TASK_6 -->
### Task 6: Extraction pipeline integration

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.6, horizon-scan.AC1.7

**Files:**
- Create: `src/pipeline/extract-articles.ts`

Orchestration function that ties fetcher + extractor together. Selects articles with `rawHtml` set but no `extractedText`, runs the extractor with the feed's `extractorConfig`, and stores results.

**Implementation:**

```typescript
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import { articles, feeds } from "../db/schema";
import { extractContent } from "./extractor";

export function extractPendingArticles(
  db: AppDatabase,
  logger: Logger,
): void {
  const pending = db
    .select({
      articleId: articles.id,
      rawHtml: articles.rawHtml,
      articleMetadata: articles.metadata,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(
      and(
        isNotNull(articles.rawHtml),
        isNull(articles.extractedText),
        eq(articles.status, "pending_assessment"),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending extraction");
    return;
  }

  for (const row of pending) {
    try {
      const feed = db
        .select({ extractorConfig: feeds.extractorConfig })
        .from(feeds)
        .where(eq(feeds.id, row.feedId))
        .get();

      if (!feed) {
        logger.warn({ articleId: row.articleId }, "feed not found for article");
        continue;
      }

      const result = extractContent(
        row.rawHtml as string,
        feed.extractorConfig,
        logger,
      );

      // Merge JSON-LD data with existing RSS metadata
      const existingMetadata =
        (row.articleMetadata as Record<string, unknown>) ?? {};
      const mergedMetadata = {
        ...existingMetadata,
        jsonLd: result.jsonLdData,
      };

      db.update(articles)
        .set({
          extractedText: result.extractedText,
          metadata: mergedMetadata,
        })
        .where(eq(articles.id, row.articleId))
        .run();

      logger.debug(
        { articleId: row.articleId, textLength: result.extractedText.length },
        "article extracted",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { articleId: row.articleId, error: message },
        "extraction failed for article",
      );
    }
  }

  logger.info({ count: pending.length }, "extraction cycle complete");
}
```

Key behaviours:
- Selects articles with `rawHtml` set but no `extractedText` yet
- Looks up each article's feed to get the `extractorConfig`
- Merges JSON-LD data into the article's existing metadata under a `jsonLd` key (AC1.6)
- Per-article try/catch — extraction errors don't block other articles
- Synchronous since better-sqlite3 is sync and Cheerio parsing is sync

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add extraction pipeline orchestration`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Extraction pipeline integration tests

**Verifies:** horizon-scan.AC1.5, horizon-scan.AC1.6, horizon-scan.AC1.7

**Files:**
- Test: `src/pipeline/extract-articles.test.ts` (integration)

**Testing:**
Uses real in-memory SQLite database via `createTestDatabase()`. Must verify:

- **horizon-scan.AC1.5 (end-to-end extraction):** Seed a feed with extractorConfig `{ bodySelector: "p.content", jsonLd: true }`. Insert an article with `rawHtml` containing `<p class="content">Article body</p>` and no `extractedText`. Run `extractPendingArticles`. Query the article — `extractedText` should contain "Article body".
- **horizon-scan.AC1.6 (JSON-LD merged):** Seed an article with `rawHtml` containing both `<p class="content">Text</p>` and `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test"}</script>`. The article row already has RSS metadata `{ prnIndustry: "Tech" }`. After extraction, the article's `metadata` should contain both the original RSS metadata and a `jsonLd` array with the parsed NewsArticle object.
- **horizon-scan.AC1.5 (skips already extracted):** Articles that already have `extractedText` set are not re-processed. Seed an article with both `rawHtml` and `extractedText` already set, run `extractPendingArticles`, verify the article's data is unchanged.
- **horizon-scan.AC1.7 (extraction error):** When Cheerio extraction throws (malformed HTML that causes a crash — rare), the article is skipped and other articles still get processed. Verify by seeding multiple articles, one with HTML that triggers an error, and checking that the others are successfully extracted.

**Verification:**
Run: `npm test`
Expected: All extraction pipeline tests pass.

**Commit:** `test: add extraction pipeline integration tests`
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_C -->
