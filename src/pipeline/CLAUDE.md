# Pipeline

Last verified: 2026-02-12

## Purpose
Implements the RSS-to-assessment data pipeline. Executes as a staged sequence: poll feeds -> deduplicate -> fetch HTML -> extract content -> assess with LLM.

## Contracts
- **Exposes**: `pollFeed`, `deduplicateAndStore`, `fetchArticle`, `fetchPendingArticles`, `extractContent`, `extractPendingArticles`, `assessPendingArticles`, `assessmentOutputSchema`
- **Guarantees**: Poll errors returned (not thrown). Dedup is idempotent via guid. Fetch retries up to 3 times then marks `failed`. Assessment produces structured output (`relevant`, `summary`, `tags`).
- **Expects**: Valid DB + config. LLM model instance for assessment (nullable -- assessment skipped if null).

## Dependencies
- **Uses**: `src/db` (schema + queries), `src/config` (extraction/assessment settings), Vercel AI SDK (`generateText` + `Output.object`), `rss-parser`, `cheerio`, `p-limit`
- **Used by**: `src/scheduler.ts` (orchestrates full pipeline on cron)
- **Boundary**: Pipeline functions are stateless -- all state lives in DB

## Pipeline Stages
1. **Poll** (`poller.ts`): Parses RSS feed URL, returns `PollResult` with items or error
2. **Dedup** (`dedup.ts`): Inserts new articles by guid, skips existing
3. **Fetch** (`fetcher.ts`): HTTP fetch of article HTML with concurrency limiting + per-domain delay
4. **Extract** (`extractor.ts` + `extract-articles.ts`): CSS selector extraction + JSON-LD parsing via cheerio
5. **Assess** (`assessor.ts`): LLM structured output per article-topic pair

## Invariants
- Fetch retry max: 3 (hardcoded). Articles exceeding this are marked `failed`
- Assessment retry max: 3. Same failure semantics
- Assessment is idempotent per article-topic pair (checks for existing before calling LLM)
- Article text truncated to `config.assessment.maxArticleLength` before LLM call

## Gotchas
- `assessor.ts` uses `@ts-expect-error` for `Output.object` due to Vercel AI SDK type depth issue
- RSS parser is lazily initialised (singleton)
- `fetchPendingArticles` uses `Promise.allSettled` -- individual fetch failures don't abort the batch
