# Horizon Scan Test Requirements

This document maps every acceptance criterion from the [design plan](design-plans/2026-02-11-horizon-scan.md) to either an automated test or a documented human verification step. It is rationalised against the implementation decisions made during planning ([phase_01](implementation-plans/2026-02-12-horizon-scan/phase_01.md) through [phase_08](implementation-plans/2026-02-12-horizon-scan/phase_08.md)).

All AC identifiers use the format `horizon-scan.AC{N}.{M}`.

**Design deviations reflected here:**

- Phase 3: `src/pipeline/extractors/prnewswire.ts` omitted -- extractor configs are data-driven via `config.yaml` and stored per-feed in the database
- Phase 4: `ollama-ai-provider-v2` instead of `ai-sdk-ollama`; `@ai-sdk/openai-compatible` instead of `zhipu-ai-provider`
- Phase 6: `digestCron` (raw cron expression string) instead of `nextDigestTime` (node-cron v4 does not expose next execution time programmatically)

---

## Automated Tests

### AC1: RSS Feed Polling and Article Storage

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC1.1 | Service polls all enabled feeds on the configured cron schedule | Unit | `src/pipeline/poller.test.ts` | `pollFeed` parses a valid RSS feed URL and returns a `PollResult` with items (rss-parser mocked) |
| horizon-scan.AC1.1 | Service polls all enabled feeds on the configured cron schedule | Unit | `src/scheduler.test.ts` | `createPollScheduler` registers a cron task with the configured expression; when fired, it queries enabled feeds and calls `pollFeed` for each one |
| horizon-scan.AC1.1 | Service polls all enabled feeds on the configured cron schedule | Unit | `src/scheduler.test.ts` | Calling `stop()` on the scheduler invokes `task.stop()` on the cron task |
| horizon-scan.AC1.2 | New RSS items stored with GUID, title, URL, published date, RSS metadata | Unit | `src/pipeline/poller.test.ts` | Parsed items contain correct guid, title, url, publishedAt Date, and metadata with custom namespace fields (prnIndustry, prnSubject, dcContributor) |
| horizon-scan.AC1.2 | New RSS items stored with GUID, title, URL, published date, RSS metadata | Unit | `src/pipeline/poller.test.ts` | When RSS item has no `guid`, the poller uses `link` as the GUID |
| horizon-scan.AC1.2 | New RSS items stored with GUID, title, URL, published date, RSS metadata | Integration | `src/pipeline/dedup.test.ts` | `deduplicateAndStore` inserts items into articles table with correct guid, title, url, publishedAt, metadata, and status `pending_assessment` |
| horizon-scan.AC1.3 | Duplicate articles (same GUID) skipped without error | Integration | `src/pipeline/dedup.test.ts` | Items with new GUIDs all insert; `newCount` matches, `skippedCount` is 0 |
| horizon-scan.AC1.3 | Duplicate articles (same GUID) skipped without error | Integration | `src/pipeline/dedup.test.ts` | Items with pre-existing GUIDs are silently skipped; `skippedCount` is correct, no errors thrown |
| horizon-scan.AC1.3 | Duplicate articles (same GUID) skipped without error | Integration | `src/pipeline/dedup.test.ts` | When all items are duplicates, `newCount` is 0, `skippedCount` equals total count |
| horizon-scan.AC1.4 | Feed error logged and skipped without blocking other feeds | Unit | `src/pipeline/poller.test.ts` | When `parseURL` throws (network error, malformed XML), `pollFeed` returns `PollResult` with zero items and non-null error -- does NOT throw |
| horizon-scan.AC1.4 | Feed error logged and skipped without blocking other feeds | Unit | `src/scheduler.test.ts` | When `pollFeed` returns error for one feed, scheduler continues to poll remaining feeds |
| horizon-scan.AC1.4 | Feed error logged and skipped without blocking other feeds | Unit | `src/scheduler.test.ts` | When `deduplicateAndStore` throws for one feed, scheduler catches it and continues to next feed |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/fetcher.test.ts` | `fetchArticle` returns `{ success: true, html }` on 200 response |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/fetcher.test.ts` | `fetchArticle` returns `{ success: false, error }` on HTTP 403/404/500 |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/fetcher.test.ts` | `fetchArticle` returns `{ success: false, error }` on timeout |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/extractor.test.ts` | Given HTML matching `bodySelector`, `extractContent` returns body text joined by double newlines |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/extractor.test.ts` | When CSS selector matches no elements, `extractedText` is empty string |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Unit | `src/pipeline/extractor.test.ts` | `metadataSelectors` extracts text from each selector and includes in results |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Integration | `src/pipeline/extract-articles.test.ts` | End-to-end: seeded article with `rawHtml` and extractor config results in `extractedText` stored in DB |
| horizon-scan.AC1.5 | Full article content fetched and extracted using Cheerio selectors | Integration | `src/pipeline/extract-articles.test.ts` | Articles already extracted are not re-processed |
| horizon-scan.AC1.6 | JSON-LD structured data parsed and merged with RSS metadata | Unit | `src/pipeline/extractor.test.ts` | HTML with `<script type="application/ld+json">` and `jsonLd: true` returns parsed object in `jsonLdData` |
| horizon-scan.AC1.6 | JSON-LD structured data parsed and merged with RSS metadata | Unit | `src/pipeline/extractor.test.ts` | Multiple JSON-LD script tags all parsed and returned |
| horizon-scan.AC1.6 | JSON-LD structured data parsed and merged with RSS metadata | Unit | `src/pipeline/extractor.test.ts` | Malformed JSON-LD silently skipped (no throw), valid tags still parsed |
| horizon-scan.AC1.6 | JSON-LD structured data parsed and merged with RSS metadata | Unit | `src/pipeline/extractor.test.ts` | When `jsonLd: false`, JSON-LD tags are not parsed |
| horizon-scan.AC1.6 | JSON-LD structured data parsed and merged with RSS metadata | Integration | `src/pipeline/extract-articles.test.ts` | Article with RSS metadata and JSON-LD in HTML ends up with merged metadata containing both sources |
| horizon-scan.AC1.7 | Fetch failure records `status: 'failed'` with retry up to 3 times | Integration | `src/pipeline/fetcher.test.ts` | `fetchPendingArticles` increments `fetchRetryCount` on fetch failure |
| horizon-scan.AC1.7 | Fetch failure records `status: 'failed'` with retry up to 3 times | Integration | `src/pipeline/fetcher.test.ts` | Article with `fetchRetryCount: 2` that fails again gets `status: 'failed'` |
| horizon-scan.AC1.7 | Fetch failure records `status: 'failed'` with retry up to 3 times | Integration | `src/pipeline/fetcher.test.ts` | Articles with `fetchRetryCount >= 3` are not selected for fetching |
| horizon-scan.AC1.7 | Fetch failure records `status: 'failed'` with retry up to 3 times | Integration | `src/pipeline/extract-articles.test.ts` | When Cheerio extraction throws, the article is skipped and others still process |

### AC2: LLM Relevance Assessment

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC2.1 | Each article assessed against every active topic | Integration | `src/pipeline/assessor.test.ts` | Given an article with extracted text and 2 active topics, `generateText` is called once per article-topic pair |
| horizon-scan.AC2.1 | Each article assessed against every active topic | Integration | `src/pipeline/assessor.test.ts` | Article-topic pairs with existing assessments are skipped |
| horizon-scan.AC2.2 | Relevant articles include summary and entity tags | Integration | `src/pipeline/assessor.test.ts` | When LLM returns `{ relevant: true, summary: "...", tags: ["AI"] }`, the assessment row contains summary and tags |
| horizon-scan.AC2.3 | Assessment returns structured output matching Zod schema | Integration | `src/pipeline/assessor.test.ts` | `generateText` call includes `output: Output.object({ schema: assessmentOutputSchema })` |
| horizon-scan.AC2.3 | Assessment returns structured output matching Zod schema | Integration | `src/pipeline/assessor.test.ts` | When LLM returns `{ relevant: false, summary: "", tags: [] }`, assessment row stores `relevant: false` |
| horizon-scan.AC2.4 | LLM failure retries up to 3 times then marks `failed` | Integration | `src/pipeline/assessor.test.ts` | When `generateText` throws, `assessmentRetryCount` increments |
| horizon-scan.AC2.4 | LLM failure retries up to 3 times then marks `failed` | Integration | `src/pipeline/assessor.test.ts` | Article with `assessmentRetryCount: 2` that fails again gets `status: 'failed'` |
| horizon-scan.AC2.4 | LLM failure retries up to 3 times then marks `failed` | Integration | `src/pipeline/assessor.test.ts` | Article text exceeding `maxArticleLength` is truncated in the prompt sent to LLM |
| horizon-scan.AC2.5 | Provider switch requires only config change | Unit | `src/llm/providers.test.ts` | `getModel` returns a `LanguageModel` instance for each of the six providers |
| horizon-scan.AC2.5 | Provider switch requires only config change | Unit | `src/llm/providers.test.ts` | `getModel` throws on unknown provider name |
| horizon-scan.AC2.5 | Provider switch requires only config change | Unit | `src/llm/providers.test.ts` | `createLlmClient` maps `AppConfig.llm.provider` to the correct provider factory |

### AC3: Email Digest

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC3.1 | Digest sent on schedule with relevant articles since last digest | Integration | `src/digest/builder.test.ts` | Builder returns only articles assessed as relevant after the last successful digest's `sentAt` |
| horizon-scan.AC3.1 | Digest sent on schedule with relevant articles since last digest | Integration | `src/digest/builder.test.ts` | First run (no prior digest rows): all relevant assessments included since epoch |
| horizon-scan.AC3.1 | Digest sent on schedule with relevant articles since last digest | Integration | `src/digest/orchestrator.test.ts` | Full cycle: mock `sendDigest` called with HTML containing topic names and article titles; digest row inserted with `status: 'success'` |
| horizon-scan.AC3.1 | Digest sent on schedule with relevant articles since last digest | Unit | `src/digest/sender.test.ts` | Mock Mailgun client returns `{ id: "msg-123" }`; `sendDigest` returns `{ success: true }` |
| horizon-scan.AC3.2 | Articles grouped by topic with title, dateline, summary, tags | Integration | `src/digest/builder.test.ts` | `topicGroups` contains entries per topic with correct articles, each having title, url, summary, tags |
| horizon-scan.AC3.2 | Articles grouped by topic with title, dateline, summary, tags | Unit | `src/digest/renderer.test.ts` | Rendered HTML contains `<h2>` headings for each topic name |
| horizon-scan.AC3.2 | Articles grouped by topic with title, dateline, summary, tags | Unit | `src/digest/renderer.test.ts` | Each article renders as linked title (`<a href>`), dateline, summary, comma-separated tags |
| horizon-scan.AC3.2 | Articles grouped by topic with title, dateline, summary, tags | Unit | `src/digest/renderer.test.ts` | Titles with `<script>` or `&` are HTML-escaped |
| horizon-scan.AC3.2 | Articles grouped by topic with title, dateline, summary, tags | Unit | `src/digest/renderer.test.ts` | Empty `topicGroups` still produces valid HTML with "0 articles" |
| horizon-scan.AC3.3 | HTML email renders with inline styles | Unit | `src/digest/renderer.test.ts` | Output contains no `<style>` tags; all styling via `style=` attributes |
| horizon-scan.AC3.3 | HTML email renders with inline styles | Unit | `src/digest/renderer.test.ts` | Output starts with `<!DOCTYPE html>` and contains valid structure |
| horizon-scan.AC3.4 | No email when no relevant articles; time window advances | Integration | `src/digest/builder.test.ts` | No new relevant assessments after last digest: `totalArticleCount` is 0, `topicGroups` empty |
| horizon-scan.AC3.4 | No email when no relevant articles; time window advances | Integration | `src/digest/orchestrator.test.ts` | Empty window: `sendDigest` NOT called, BUT digest row inserted with `articleCount: 0` and `status: 'success'` |
| horizon-scan.AC3.5 | Mailgun failure logged; digest recorded as failed; articles available next cycle | Integration | `src/digest/orchestrator.test.ts` | Mock `sendDigest` returns failure: digest row inserted with `status: 'failed'`; assessments still queryable |
| horizon-scan.AC3.5 | Mailgun failure logged; digest recorded as failed; articles available next cycle | Unit | `src/digest/sender.test.ts` | Mock Mailgun client throws: `sendDigest` returns `{ success: false }` without throwing |

### AC4: Configuration and Startup

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC4.1 | Service starts with valid config and seeds database on first run | Integration | `src/seed.test.ts` | Empty DB + config with 2 feeds: `seedDatabase` inserts 2 feed rows with correct field values |
| horizon-scan.AC4.1 | Service starts with valid config and seeds database on first run | Integration | `src/seed.test.ts` | Empty DB + config with 2 topics: `seedDatabase` inserts 2 topic rows matching config |
| horizon-scan.AC4.1 | Service starts with valid config and seeds database on first run | Integration | `src/seed.test.ts` | Idempotent: calling `seedDatabase` twice does not duplicate rows |
| horizon-scan.AC4.1 | Service starts with valid config and seeds database on first run | Integration | `src/seed.test.ts` | Independent seeding: pre-existing feeds prevent feed seed but topics still seed if empty |
| horizon-scan.AC4.1 | Service starts with valid config and seeds database on first run | Integration | `src/index.test.ts` | Startup wiring: create in-memory DB, load valid config, call `seedDatabase` -- feeds and topics present |
| horizon-scan.AC4.2 | Invalid config causes startup failure with clear error | Integration | `src/index.test.ts` | `loadConfig` with YAML missing `llm` section throws containing `"invalid configuration"` and the path |
| horizon-scan.AC4.2 | Invalid config causes startup failure with clear error | Integration | `src/index.test.ts` | `loadConfig` with `llm.provider: "invalid_provider"` throws with Zod enum validation error |
| horizon-scan.AC4.2 | Invalid config causes startup failure with clear error | Integration | `src/index.test.ts` | `cron.schedule("not a cron", callback)` throws at runtime (sanity check) |

### AC5: API Layer

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC5.1 | tRPC endpoints return correct data with proper typing | Integration | `src/api/routers/feeds.test.ts` | `caller.feeds.list()` returns seeded feeds with correct fields |
| horizon-scan.AC5.1 | tRPC endpoints return correct data with proper typing | Integration | `src/api/routers/articles.test.ts` | `caller.articles.list({ feedId })` filters correctly; `status` filter and `limit`/`offset` pagination work |
| horizon-scan.AC5.1 | tRPC endpoints return correct data with proper typing | Integration | `src/api/routers/articles.test.ts` | `caller.assessments.list({ relevant: true })` returns only relevant assessments |
| horizon-scan.AC5.2 | Feed and topic CRUD reflected in subsequent queries | Integration | `src/api/routers/feeds.test.ts` | Create feed via `caller.feeds.create()`; verify appears in `list()`; update; verify change in `getById()`; delete; verify gone from `list()` |
| horizon-scan.AC5.2 | Feed and topic CRUD reflected in subsequent queries | Integration | `src/api/routers/topics.test.ts` | Topic CRUD: create, read, update, delete with verification at each step |
| horizon-scan.AC5.3 | `system.status` returns health info | Integration | `src/api/routers/system.test.ts` | `caller.system.status()` returns `lastPollTime`, `digestCron` (cron string from config), `provider`, `model`, `feedCount`, `topicCount` |

### AC6: Deployment and Operations

| AC ID | Description | Test Type | Test File | What Test Verifies |
|---|---|---|---|---|
| horizon-scan.AC6.1 | Graceful shutdown on SIGTERM/SIGINT | Unit | `src/lifecycle.test.ts` | Emitting `SIGTERM` calls all scheduler `.stop()` methods, then `closeDb`, then `process.exit(0)` |
| horizon-scan.AC6.1 | Graceful shutdown on SIGTERM/SIGINT | Unit | `src/lifecycle.test.ts` | Emitting `SIGINT` triggers same shutdown sequence |
| horizon-scan.AC6.1 | Graceful shutdown on SIGTERM/SIGINT | Unit | `src/lifecycle.test.ts` | Multiple schedulers (3): all `.stop()` methods called |
| horizon-scan.AC6.1 | Graceful shutdown on SIGTERM/SIGINT | Unit | `src/lifecycle.test.ts` | Double signal: `closeDb` called only once (re-entrant guard) |
| horizon-scan.AC6.1 | Graceful shutdown on SIGTERM/SIGINT | Unit | `src/lifecycle.test.ts` | Scheduler `.stop()` throws: `closeDb` still called |
| horizon-scan.AC6.2 | Structured JSON logs via pino | Integration | `src/index.test.ts` | Logger output is JSON with `level` (string label), `time` (ISO format), and `msg` fields |

---

## Human Verification

The following acceptance criteria cannot be fully automated because they depend on runtime infrastructure, visual rendering, or external service behaviour that cannot be meaningfully replicated in a test harness.

| AC ID | Description | Justification | Verification Approach |
|---|---|---|---|
| horizon-scan.AC3.3 | HTML email renders correctly with inline styles | Automated tests verify structural properties (no `<style>` tags, inline `style=` attributes, valid HTML skeleton), but actual rendering across email clients (Gmail, Outlook, Apple Mail) requires visual inspection. Email client rendering engines are not available in test environments. | Trigger a test digest with representative data. Send to test inboxes on Gmail, Outlook (desktop + web), and Apple Mail. Visually verify: topic headings, article links open correctly, dateline displays, summary text readable, tag badges visible. Check responsiveness on mobile viewport. |
| horizon-scan.AC6.3 | `docker build` produces a working OCI image | Building a Docker image requires the Docker daemon. CI can automate `docker build`, but the acceptance criterion is "produces a *working* OCI image" which means verifying the multi-stage build compiles native modules (better-sqlite3), copies artefacts correctly, and the final image starts. This is infrastructure-level, not unit-testable. | Run `docker build -t horizon-scan .` and verify exit code 0. Run `docker run --rm horizon-scan node -e "require('better-sqlite3')"` to verify native module loads. Inspect image size and layer count for sanity. In CI, add a `docker build` step to the pipeline. |
| horizon-scan.AC6.4 | Container runs with mounted config and SQLite data volume | Requires Docker runtime with volume mounts and network. Tests cannot simulate bind mounts, named volumes, or container-host networking (e.g., `host.docker.internal` for Ollama). | Run `docker compose up -d`. Verify startup via `docker compose logs`. Curl `http://localhost:3000/health` for `{"status":"ok"}`. Stop and restart container; verify SQLite data persists across restarts by checking article/feed counts via the API. Run `docker compose down` and verify clean shutdown (exit code 0, no error logs). |

---

## Coverage Summary

| AC Group | Total Criteria | Automated | Human Verification | Coverage |
|---|---|---|---|---|
| AC1: RSS Feed Polling and Article Storage | 7 | 7 | 0 | 100% |
| AC2: LLM Relevance Assessment | 5 | 5 | 0 | 100% |
| AC3: Email Digest | 5 | 5 | 1 (partial) | 100% (AC3.3 has both automated structural checks and human visual verification) |
| AC4: Configuration and Startup | 2 | 2 | 0 | 100% |
| AC5: API Layer | 3 | 3 | 0 | 100% |
| AC6: Deployment and Operations | 4 | 2 | 2 | 100% (AC6.1 and AC6.2 automated; AC6.3 and AC6.4 require Docker runtime) |
| **Total** | **26** | **24** | **3** | **100%** |

Every acceptance criterion maps to at least one automated test or a documented human verification approach. Three criteria (AC3.3, AC6.3, AC6.4) include human verification steps; of these, AC3.3 also has automated structural tests covering its testable properties.

### Test File Summary

| Test File | Test Type | Phase | ACs Covered |
|---|---|---|---|
| `src/pipeline/poller.test.ts` | Unit | 2 | AC1.1, AC1.2, AC1.4 |
| `src/pipeline/dedup.test.ts` | Integration | 2 | AC1.2, AC1.3 |
| `src/scheduler.test.ts` | Unit | 2 | AC1.1, AC1.4 |
| `src/pipeline/fetcher.test.ts` | Unit + Integration | 3 | AC1.5, AC1.7 |
| `src/pipeline/extractor.test.ts` | Unit | 3 | AC1.5, AC1.6 |
| `src/pipeline/extract-articles.test.ts` | Integration | 3 | AC1.5, AC1.6, AC1.7 |
| `src/llm/providers.test.ts` | Unit | 4 | AC2.5 |
| `src/pipeline/assessor.test.ts` | Unit + Integration | 4 | AC2.1, AC2.2, AC2.3, AC2.4 |
| `src/digest/builder.test.ts` | Integration | 5 | AC3.1, AC3.2, AC3.4 |
| `src/digest/renderer.test.ts` | Unit | 5 | AC3.2, AC3.3 |
| `src/digest/sender.test.ts` | Unit | 5 | AC3.1, AC3.5 |
| `src/digest/orchestrator.test.ts` | Integration | 5 | AC3.1, AC3.4, AC3.5 |
| `src/api/routers/feeds.test.ts` | Integration | 6 | AC5.1, AC5.2 |
| `src/api/routers/topics.test.ts` | Integration | 6 | AC5.2 |
| `src/api/routers/articles.test.ts` | Integration | 6 | AC5.1 |
| `src/api/routers/system.test.ts` | Integration | 6 | AC5.3 |
| `src/seed.test.ts` | Integration | 7 | AC4.1 |
| `src/lifecycle.test.ts` | Unit | 7 | AC6.1 |
| `src/index.test.ts` | Integration | 7 | AC4.1, AC4.2, AC6.2 |
