# Horizon Scan Design

## Summary

**Horizon Scan** is an RSS-based news monitoring system that uses LLMs to filter relevant stories and delivers them as email digests. The service polls configured RSS feeds, fetches full article content from the web, and evaluates each piece against user-defined semantic topics using multi-provider LLM support (Anthropic, OpenAI, Gemini, Ollama, LM Studio, Z.ai). Articles judged relevant get summarised and tagged, then bundled into scheduled HTML email digests grouped by topic.

The architecture follows a **pipeline pattern** with SQLite as the inter-stage communication layer. Two independent cron loops run: one for polling/fetching/assessing articles, another for compiling and sending digests. A tRPC API layer exposes feeds, topics, articles, and assessments for future UI integration. Content extraction uses per-feed Cheerio configs stored in the database, enabling new sources to be added without code changes. The system handles partial failures gracefully (rate limits, malformed feeds, fetch timeouts) via retry logic and structured logging. Deployment is containerised with SQLite data on a volume mount.

## Definition of Done

1. A containerised TypeScript service that polls configurable RSS feeds on a schedule, fetches full articles, and stores them in SQLite (deduped by GUID)
2. Multi-provider LLM support (Ollama, LM Studio, Anthropic, OpenAI, Z.ai, Gemini) that assesses each new article against user-defined semantic topics — returns relevant/not-relevant + summary + entity tags
3. An HTML email digest sent via Mailgun on a configurable schedule containing all relevant stories since the last digest
4. Configuration via env vars (secrets) + config file (feeds, topics, schedules, LLM provider)
5. An internal API layer that could later serve a frontend
6. Dockerfile for deployment

## Acceptance Criteria

### horizon-scan.AC1: RSS feed polling and article storage
- **horizon-scan.AC1.1 Success:** Service polls all enabled feeds on the configured cron schedule
- **horizon-scan.AC1.2 Success:** New RSS items are stored with GUID, title, URL, published date, and RSS metadata
- **horizon-scan.AC1.3 Success:** Duplicate articles (same GUID) are skipped without error
- **horizon-scan.AC1.4 Failure:** A feed that returns an error (DNS failure, malformed XML, timeout) is logged and skipped without blocking other feeds
- **horizon-scan.AC1.5 Success:** Full article content is fetched from article URL and extracted using configured Cheerio selectors
- **horizon-scan.AC1.6 Success:** JSON-LD structured data is parsed when available and merged with RSS metadata
- **horizon-scan.AC1.7 Failure:** Article fetch failure (403, timeout, parse error) records the article with `status: 'failed'` and retries up to 3 times on subsequent cycles

### horizon-scan.AC2: LLM relevance assessment
- **horizon-scan.AC2.1 Success:** Each new article is assessed against every active topic, producing a binary relevant/not-relevant result
- **horizon-scan.AC2.2 Success:** Relevant articles include a 2-3 sentence summary and extracted entity tags
- **horizon-scan.AC2.3 Success:** Assessment returns structured output matching the Zod schema (`{ relevant, summary, tags }`)
- **horizon-scan.AC2.4 Failure:** LLM call failure (rate limit, timeout, invalid response) leaves article as `pending_assessment` and retries up to 3 times before marking `failed`
- **horizon-scan.AC2.5 Success:** Switching LLM provider requires only a config file change (provider + model), no code changes

### horizon-scan.AC3: Email digest
- **horizon-scan.AC3.1 Success:** Digest email is sent on the configured cron schedule containing all articles assessed as relevant since the last digest
- **horizon-scan.AC3.2 Success:** Digest groups articles by topic with title (linked to original), dateline, LLM summary, and entity tags
- **horizon-scan.AC3.3 Success:** HTML email renders correctly with inline styles
- **horizon-scan.AC3.4 Edge:** No email is sent when no relevant articles exist in the digest window, but the time window advances
- **horizon-scan.AC3.5 Failure:** Mailgun send failure is logged, digest recorded with `status: 'failed'`, articles remain available for next digest

### horizon-scan.AC4: Configuration
- **horizon-scan.AC4.1 Success:** Service starts with valid env vars + config.yaml and seeds feeds/topics into database on first run
- **horizon-scan.AC4.2 Failure:** Invalid configuration (missing required fields, bad cron expression, unknown provider) causes startup failure with clear error message

### horizon-scan.AC5: API layer
- **horizon-scan.AC5.1 Success:** tRPC endpoints for feeds, topics, articles, assessments, digests return correct data with proper typing
- **horizon-scan.AC5.2 Success:** Feed and topic CRUD operations modify the database and are reflected in subsequent queries
- **horizon-scan.AC5.3 Success:** `system.status` endpoint returns health info including last poll time, next digest time, and configured provider

### horizon-scan.AC6: Deployment and operations
- **horizon-scan.AC6.1 Success:** Service shuts down gracefully on SIGTERM/SIGINT — in-flight work completes, DB connection closes cleanly
- **horizon-scan.AC6.2 Success:** Structured JSON logs via pino include feed poll results, fetch outcomes, assessment results, and digest send status
- **horizon-scan.AC6.3 Success:** `docker build` produces a working OCI image
- **horizon-scan.AC6.4 Success:** Container runs with mounted config file and SQLite data volume, service operates correctly

## Glossary

- **RSS (Really Simple Syndication)**: XML-based feed format for syndicating content updates. Includes item title, link, publication date, and optional metadata.
- **GUID (Globally Unique Identifier)**: Per-item identifier in RSS feeds used for deduplication. May be a URL or opaque string. Must be unique within a feed.
- **JSON-LD (JSON for Linking Data)**: Structured data format embedded in web pages. `NewsArticle` schema includes headline, datePublished, author, and publisher fields.
- **Cheerio**: Server-side jQuery-like library for parsing HTML and extracting content via CSS selectors.
- **Drizzle ORM**: Type-safe TypeScript ORM for SQLite, MySQL, and PostgreSQL. Provides compile-time query validation and schema migrations.
- **tRPC (TypeScript Remote Procedure Call)**: End-to-end typesafe API framework. Clients get auto-generated types from server router definitions without code generation.
- **Vercel AI SDK**: Unified TypeScript interface for multiple LLM providers. Supports structured output via Zod schemas and `generateObject()` method.
- **Zod**: TypeScript schema validation library. Runtime type checking with static type inference.
- **Cron expression**: Time-based scheduling syntax (e.g., `0 8 * * 1-5` for weekdays at 8am). Used by `node-cron` to trigger pipeline loops.
- **Concurrency limiting**: Bounding simultaneous HTTP requests to avoid overwhelming target servers. Default: 2 concurrent fetches with 1s per-domain delay.
- **Graceful shutdown**: Process termination pattern that completes in-flight work before exiting. Prevents database corruption and data loss on container restarts.
- **OCI (Open Container Initiative)**: Container image standard. Docker is one implementation; images run on any OCI-compliant runtime.
- **Pino**: Fast, low-overhead JSON logger for Node.js. Structured logs are machine-parseable for aggregation and analysis.
- **Mailgun**: Transactional email API service. Used for delivering digest emails.
- **SQLite**: Embedded SQL database engine stored in a single file. No separate server process required.
- **Ollama**: Local LLM inference server that exposes an OpenAI-compatible API. Runs models like Llama, Mistral, etc. on your own hardware.
- **LM Studio**: Desktop application for running local LLMs with an OpenAI-compatible server mode.
- **Z.ai (Zhipu AI)**: Chinese LLM provider. Accessed via community Vercel AI SDK adapter.

## Architecture

Pipeline architecture with two independent scheduled loops and a tRPC API layer. The database (SQLite via Drizzle ORM + better-sqlite3) is the single source of truth and the communication layer between pipeline stages.

### Poll Loop

Triggered by a cron schedule (configurable, e.g., every 15 minutes):

1. **Poller** — iterates configured RSS feeds via `rss-parser`, extracts items with metadata (`prn:industry`, `prn:subject`, `dc:contributor`)
2. **Dedup** — checks each item's GUID against `articles.guid` (UNIQUE constraint). Skips known articles.
3. **Fetcher** — HTTP-fetches the article URL for new items. Extracts content using Cheerio with per-feed selector configs. Parses JSON-LD `NewsArticle` structured data when available. Concurrency-limited (default: 2) with per-domain delay (default: 1s).
4. **Store** — writes article record with extracted text, merged metadata (RSS + page-level), and `status: 'pending_assessment'`
5. **Assessor** — sends article text + metadata to configured LLM via Vercel AI SDK. Uses `generateObject()` with a Zod schema to get structured output: `{ relevant: boolean, summary: string | null, tags: string[] }`. One assessment per article per active topic. Updates article status to `assessed` or `failed`.

### Digest Loop

Triggered by a separate cron schedule (configurable, e.g., weekdays at 8am):

1. **Digest Builder** — queries articles with at least one relevant assessment since the last digest. Groups by topic, sorts by `published_at` descending.
2. **Email Renderer** — renders HTML email from a TypeScript template function with inline styles. Per-topic sections with article title (linked), dateline, LLM summary, and entity tag badges.
3. **Sender** — dispatches via Mailgun API (`mailgun.js`). Records digest in `digests` table. If no relevant articles exist, no email is sent but the time window advances.

### API Layer

Express + tRPC router exposing typed endpoints for future UI consumption:

```typescript
// tRPC router shape
feeds.list / feeds.create / feeds.update / feeds.delete
topics.list / topics.create / topics.update / topics.delete
articles.list (filters: feed, status, date range, relevance) / articles.get
assessments.list (by article or by topic)
digests.list / digests.get
system.status (health, last poll, next digest, configured provider)
```

No auth for MVP. Structured so auth middleware can be inserted without changing route handlers.

### Data Model

**`feeds`** — configured RSS sources
- `id`, `name`, `url`, `extractor_config` (JSON — site-specific Cheerio selectors), `poll_interval_minutes`, `enabled`, `last_polled_at`, `created_at`

**`articles`** — fetched content
- `id`, `feed_id` (FK), `guid` (UNIQUE, indexed), `title`, `url`, `published_at`, `raw_html` (nullable), `extracted_text`, `metadata` (JSON), `status` (enum: `pending_assessment` | `assessed` | `failed`), `fetch_retry_count`, `assessment_retry_count`, `fetched_at`, `created_at`

**`assessments`** — LLM evaluation results, one per article per topic
- `id`, `article_id` (FK), `topic_id` (FK), `relevant` (boolean), `summary` (text, nullable), `tags` (JSON array), `model_used`, `provider`, `assessed_at`

**`topics`** — user-defined semantic topics of interest
- `id`, `name`, `description` (nuanced prompt text), `enabled`, `created_at`

**`digests`** — sent email history
- `id`, `sent_at`, `article_count`, `recipient`, `status` (enum: `success` | `failed`)

### LLM Provider Configuration

Vercel AI SDK with provider adapters:

| Provider | Package | Notes |
|----------|---------|-------|
| Anthropic | `@ai-sdk/anthropic` | First-party |
| OpenAI | `@ai-sdk/openai` | First-party |
| Google Gemini | `@ai-sdk/google` | First-party |
| Ollama | `ai-sdk-ollama` | Community provider |
| LM Studio | `@ai-sdk/openai` | OpenAI provider with custom `baseURL` |
| Z.ai / Zhipu | `zhipu-ai-provider` | Community provider |

Config file specifies `llm.provider` + `llm.model`. Only the configured provider's API key is required.

### Content Extraction

Per-feed extractor configs stored in the `feeds` table as JSON:

```typescript
interface ExtractorConfig {
  bodySelector: string;       // CSS selector for article body elements
  jsonLd: boolean;            // whether to parse JSON-LD NewsArticle
  metadataSelectors?: {       // optional per-site metadata selectors
    [key: string]: string;
  };
}
```

PRNewswire default config targets `p.prnews_p` for body text and parses JSON-LD for headline, datePublished, and publisher. Adding a new feed source requires only a database row with URL and extractor config — no code changes.

### Configuration

**Environment variables (secrets):**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ZAI_API_KEY`
- `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`

**Config file (`config.yaml`):**
- `llm.provider`, `llm.model`
- `feeds[]` — initial feed list (seeded into DB on first run)
- `topics[]` — initial topics (seeded into DB on first run)
- `schedule.poll`, `schedule.digest` — cron expressions
- `digest.recipient`
- `extraction.maxConcurrency`, `extraction.perDomainDelayMs`
- `assessment.maxArticleLength` — truncation limit for LLM input

Loaded at startup with Zod validation. Invalid config fails fast.

### Error Handling

Each pipeline stage fails gracefully without blocking the system:

| Stage | Failure Behaviour |
|-------|-------------------|
| Feed poll | Log error, skip feed, continue. `last_polled_at` unchanged so retries next cycle. |
| Article fetch | Store with `status: 'failed'`, increment `fetch_retry_count`. Retry up to 3. |
| LLM assessment | Stay `pending_assessment`, increment `assessment_retry_count`. Retry up to 3, then `failed`. |
| Digest send | Log, record digest with `status: 'failed'`. Articles not marked as digested — included in next successful send. |
| Startup | Fail fast on invalid config or migration error. |

### Observability

Structured JSON logging via `pino`. Log level configurable. Logs: feed poll start/end with counts, fetch results, assessment results (relevant/not per topic), digest send results, scheduler events. No external metrics stack for MVP — `pino` JSON logs are parseable by any log aggregator added later. `system.status` endpoint provides basic health view.

### Graceful Shutdown

Listens for `SIGTERM`/`SIGINT`. Stops new cron triggers, waits for in-flight pipeline stages (with timeout), closes DB connection, exits cleanly. Prevents SQLite corruption from mid-write kills.

### Containerisation

Multi-stage Dockerfile. Stage 1: `node:22-alpine` for TypeScript build + dependency install. Stage 2: `node:22-alpine` with production deps + compiled JS + `better-sqlite3` native binary. SQLite data directory as a volume mount. Standard OCI image — works with Docker, Apple Containers, or any OCI runtime.

## Existing Patterns

This is a greenfield project with no existing codebase patterns. The design introduces:

- **Pipeline architecture** with database as the inter-stage communication layer
- **Drizzle ORM** for type-safe SQLite access
- **Vercel AI SDK** for multi-provider LLM abstraction
- **Express + tRPC** for typed API endpoints
- **Cheerio** for HTML content extraction with per-feed selector configs
- **pino** for structured JSON logging

These are standard, well-documented patterns in the TypeScript ecosystem. No novel architectural decisions.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Project Scaffolding & Database

**Goal:** Initialise TypeScript project, configure tooling, set up SQLite database with Drizzle ORM schema and migrations.

**Components:**
- `package.json` with core dependencies (typescript, drizzle-orm, better-sqlite3, pino, zod)
- `tsconfig.json` with strict mode
- `drizzle.config.ts` for migration configuration
- `src/db/schema.ts` — Drizzle schema definitions for all five tables
- `src/db/index.ts` — database connection setup
- `src/config/schema.ts` — Zod schema for config.yaml validation
- `src/config/index.ts` — config loader (env vars + YAML file)
- `config.yaml` — example configuration file
- `.env.example` — environment variable template

**Dependencies:** None (first phase)

**Done when:** `npm install` succeeds, `npm run build` succeeds, database migrations run, config loads and validates
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: RSS Polling & Deduplication

**Goal:** Poll RSS feeds on a schedule, extract items with metadata, deduplicate against existing articles in the database.

**Components:**
- `src/pipeline/poller.ts` — RSS feed polling via `rss-parser`, metadata extraction (`prn:industry`, `prn:subject`, `dc:contributor`)
- `src/pipeline/dedup.ts` — GUID-based deduplication against `articles` table
- `src/scheduler.ts` — `node-cron` scheduler for poll loop

**Dependencies:** Phase 1 (database, config)

**Covers:** horizon-scan.AC1.1, horizon-scan.AC1.2, horizon-scan.AC1.3, horizon-scan.AC1.4

**Done when:** Service polls configured feeds on schedule, new articles are stored with GUIDs, duplicate articles are skipped, feed errors are logged and don't block other feeds
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Article Content Extraction

**Goal:** Fetch full article content from URLs, extract text and metadata using Cheerio with per-feed selector configs.

**Components:**
- `src/pipeline/fetcher.ts` — HTTP fetch with concurrency limiting and per-domain delay
- `src/pipeline/extractor.ts` — Cheerio-based content extraction, JSON-LD parsing
- `src/pipeline/extractors/prnewswire.ts` — PRNewswire default extractor config

**Dependencies:** Phase 2 (articles exist in database with URLs)

**Covers:** horizon-scan.AC1.5, horizon-scan.AC1.6, horizon-scan.AC1.7

**Done when:** Articles are fetched with rate limiting, body text and metadata extracted correctly from PRNewswire pages, fetch failures recorded with retry counts
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: LLM Assessment

**Goal:** Assess extracted articles against user-defined topics using Vercel AI SDK, store binary relevance + summary + entity tags.

**Components:**
- `src/pipeline/assessor.ts` — LLM assessment orchestration, prompt construction, structured output parsing via Zod schema
- `src/llm/client.ts` — Vercel AI SDK client initialisation from config (provider + model selection)
- `src/llm/providers.ts` — provider adapter registration for all six providers

**Dependencies:** Phase 3 (articles have extracted text), Phase 1 (topics in database)

**Covers:** horizon-scan.AC2.1, horizon-scan.AC2.2, horizon-scan.AC2.3, horizon-scan.AC2.4, horizon-scan.AC2.5

**Done when:** Articles are assessed per topic, relevant articles have summaries and tags, assessment failures retry up to cap, provider switching works via config change
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Email Digest

**Goal:** Compile relevant articles into an HTML email digest and send via Mailgun on a configurable schedule.

**Components:**
- `src/digest/builder.ts` — query relevant articles since last digest, group by topic
- `src/digest/renderer.ts` — HTML email template with inline styles
- `src/digest/sender.ts` — Mailgun API integration
- `src/scheduler.ts` — extended with digest schedule

**Dependencies:** Phase 4 (articles have assessments)

**Covers:** horizon-scan.AC3.1, horizon-scan.AC3.2, horizon-scan.AC3.3, horizon-scan.AC3.4, horizon-scan.AC3.5

**Done when:** Digest email sent on schedule with relevant articles grouped by topic, empty windows skip email send, digest history recorded
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: tRPC API Layer

**Goal:** Expose articles, assessments, feeds, topics, and digest history via typed tRPC endpoints over Express.

**Components:**
- `src/api/server.ts` — Express server setup
- `src/api/trpc.ts` — tRPC initialisation
- `src/api/routers/feeds.ts` — feed CRUD
- `src/api/routers/topics.ts` — topic CRUD
- `src/api/routers/articles.ts` — article listing with filters
- `src/api/routers/assessments.ts` — assessment queries
- `src/api/routers/digests.ts` — digest history
- `src/api/routers/system.ts` — health/status endpoint

**Dependencies:** Phase 1 (database), Phase 4 (assessments exist)

**Covers:** horizon-scan.AC5.1, horizon-scan.AC5.2, horizon-scan.AC5.3

**Done when:** All endpoints return correct data, feed/topic CRUD works, article filtering works, system status reports health
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Service Lifecycle & Observability

**Goal:** Wire all components into a runnable service with structured logging, graceful shutdown, and config-driven startup.

**Components:**
- `src/index.ts` — main entry point, service lifecycle orchestration
- `src/logger.ts` — pino logger configuration
- `src/lifecycle.ts` — graceful shutdown handler (SIGTERM/SIGINT)
- `src/seed.ts` — initial database seeding from config file (feeds, topics)

**Dependencies:** All previous phases

**Covers:** horizon-scan.AC4.1, horizon-scan.AC4.2, horizon-scan.AC6.1, horizon-scan.AC6.2

**Done when:** Service starts from config, seeds database on first run, runs both cron loops, shuts down gracefully, logs structured JSON
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Containerisation

**Goal:** Multi-stage Dockerfile, volume mount for SQLite, documentation.

**Components:**
- `Dockerfile` — multi-stage build (build + runtime)
- `.dockerignore`
- `docker-compose.yml` — convenience for local development with volume mounts

**Dependencies:** Phase 7 (service runs)

**Covers:** horizon-scan.AC6.3, horizon-scan.AC6.4

**Done when:** `docker build` succeeds, container runs with mounted config and data volume, service operates correctly in container
<!-- END_PHASE_8 -->

## Additional Considerations

**Article text truncation:** Long press releases are truncated to a configurable maximum (default: 4000 chars) before LLM assessment to control token costs. The prompt notes truncation so the LLM doesn't assume the text is complete. Title and metadata alone often carry sufficient signal.

**Assessment is per-topic:** An article about pharmaceutical supply chains may be relevant to one topic but not another. The digest builder joins on relevant assessments, so the same article can appear under multiple topic sections if relevant to several.

**Config seeding:** On first run, feeds and topics from `config.yaml` are seeded into the database. Subsequent runs don't re-seed — the database is the source of truth. The API (and future UI) manages feeds/topics going forward.
