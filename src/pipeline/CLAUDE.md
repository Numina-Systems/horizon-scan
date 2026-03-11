# Pipeline

Last verified: 2026-02-12

## Purpose
Implements the RSS-to-assessment data pipeline. Executes as a staged sequence: poll feeds -> deduplicate -> fetch HTML -> extract content -> assess with LLM.

## Contracts
- **Exposes**: `pollFeed`, `deduplicateAndStore`, `processPendingDedup`, `fallbackPendingDedup`, `fetchArticle`, `fetchPendingArticles`, `extractContent`, `extractPendingArticles`, `assessPendingArticles`, `assessmentOutputSchema`
- **Guarantees**: Poll errors returned (not thrown). Dedup is idempotent via guid. Embedding dedup retries up to 3 times then falls back to GUID-only. Fetch retries up to 3 times then marks `failed`. Assessment produces structured output (`relevant`, `summary`, `tags`).
- **Expects**: Valid DB + config. LLM model instance for assessment (nullable -- assessment skipped if null). Embedding model for dedup (nullable -- fallback to GUID-only if null).

## Dependencies
- **Uses**: `src/db` (schema + queries), `src/config` (extraction/assessment/dedup settings), `src/embedding` (embedding generation + cosine similarity), Vercel AI SDK (`generateText` + `Output.object`), `rss-parser`, `cheerio`, `p-limit`
- **Used by**: `src/scheduler.ts` (orchestrates full pipeline on cron)
- **Boundary**: Pipeline functions are stateless -- all state lives in DB

## Pipeline Stages
1. **Poll** (`poller.ts`): Parses RSS feed URL, returns `PollResult` with items or error
2. **Dedup** (`dedup.ts`): Inserts new articles by guid, skips existing
2.5. **Embedding Dedup** (`embedding-dedup.ts`): Batch embedding generation + cosine similarity dedup with retry and fallback
3. **Fetch** (`fetcher.ts`): HTTP fetch of article HTML with concurrency limiting + per-domain delay
4. **Extract** (`extractor.ts` + `extract-articles.ts`): CSS selector extraction + JSON-LD parsing via cheerio
5. **Assess** (`assessor.ts`): LLM structured output per article-topic pair

## Invariants
- Embedding retry max: 3. Articles exceeding this fall back to GUID-only dedup (transition to `pending_assessment` without embedding)
- Fetch retry max: 3 (hardcoded). Articles exceeding this are marked `failed`
- Assessment retry max: 3. Same failure semantics
- Assessment is idempotent per article-topic pair (checks for existing before calling LLM)
- Article text truncated to `config.assessment.maxArticleLength` before LLM call
- Embedding dimension validation: Expected 1024 dimensions. Mismatched dimension treated as error, triggers retry

## Gotchas
- `assessor.ts` uses `@ts-expect-error` for `Output.object` due to Vercel AI SDK type depth issue
- RSS parser is lazily initialised (singleton)
- `fetchPendingArticles` uses `Promise.allSettled` -- individual fetch failures don't abort the batch
