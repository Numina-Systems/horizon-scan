# Embedding Dedup Implementation Plan

**Goal:** Rewrite dedup module for batch embedding-based deduplication with cosine similarity comparison

**Architecture:** The current `deduplicateAndStore` function inserts articles with `pending_assessment` status using GUID-only dedup. This phase: (1) changes the initial insert status to `pending_dedup`, (2) adds a new `processPendingDedup` batch function that generates embeddings, compares against recent articles, and transitions articles to either `duplicate` or `pending_assessment`. The batch function follows the same pattern as `fetchPendingArticles` and `assessPendingArticles` — query all pending, process, update status.

**Tech Stack:** Drizzle ORM, Vercel AI SDK (embed + cosineSimilarity), TypeScript

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

### embedding-dedup.AC1: Embedding generation
- **embedding-dedup.AC1.1 Success:** New articles generate embeddings using title + first 1000 chars of body
- **embedding-dedup.AC1.2 Success:** Embeddings are 768-dimensional float arrays (qwen3-embedding:0.6b)

### embedding-dedup.AC2: Embedding storage
- **embedding-dedup.AC2.1 Success:** Embeddings stored as JSON array in articles.embedding column
- **embedding-dedup.AC2.2 Success:** Embedding persisted within same transaction as status update

### embedding-dedup.AC3: Similarity-based deduplication
- **embedding-dedup.AC3.1 Success:** Articles with cosine similarity >= 0.90 marked as duplicate
- **embedding-dedup.AC3.2 Success:** Articles with similarity < 0.90 transition to pending_assessment
- **embedding-dedup.AC3.3 Success:** Comparison limited to articles within lookback window (default 15 days)
- **embedding-dedup.AC3.4 Success:** Per-feed lookback override respected when configured

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Change deduplicateAndStore to insert with pending_dedup status

**Files:**
- Modify: `src/pipeline/dedup.ts:37` (change status literal)

**Implementation:**

In `src/pipeline/dedup.ts`, change line 37 from:

```typescript
status: "pending_assessment",
```

to:

```typescript
status: "pending_dedup",
```

This is the only change needed — new articles now enter the pipeline as `pending_dedup` instead of going straight to `pending_assessment`. The downstream fetch/extract/assess stages already filter by `eq(articles.status, "pending_assessment")`, so they won't pick up articles until the dedup batch job transitions them.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors (the updated schema enum from Phase 1 includes `pending_dedup`)

**Commit:** `feat(dedup): change initial article status to pending_dedup`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update existing dedup tests for pending_dedup status

**Files:**
- Modify: `src/pipeline/dedup.test.ts`

**Implementation:**

Update all test assertions that check for `status: "pending_assessment"` to check for `status: "pending_dedup"` instead. The tests verify that `deduplicateAndStore` inserts articles with the correct initial status.

Search for all occurrences of `"pending_assessment"` in the test file and replace with `"pending_dedup"`.

**Verification:**
Run: `npm test`
Expected: All dedup tests pass with the new status

**Commit:** `test(dedup): update assertions for pending_dedup status`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Add EmbeddingDedupResult type and export processPendingDedup signature

**Files:**
- Modify: `src/pipeline/types.ts` (add new types)

**Implementation:**

Add to `src/pipeline/types.ts`:

```typescript
export type EmbeddingDedupResult = {
  readonly processedCount: number;
  readonly duplicateCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
};
```

This follows the existing `DedupResult` pattern — a readonly result type summarising the batch operation.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(pipeline): add EmbeddingDedupResult type`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Implement processPendingDedup batch function

**Verifies:** embedding-dedup.AC1.1, embedding-dedup.AC1.2, embedding-dedup.AC2.1, embedding-dedup.AC2.2, embedding-dedup.AC3.1, embedding-dedup.AC3.2, embedding-dedup.AC3.3, embedding-dedup.AC3.4

**Files:**
- Create: `src/pipeline/embedding-dedup.ts`

**Implementation:**

Create `processPendingDedup` function following the batch processing pattern from `fetchPendingArticles` (`src/pipeline/fetcher.ts:56-127`) and `assessPendingArticles` (`src/pipeline/assessor.ts:52-205`):

```typescript
import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { EmbeddingModel } from "ai";
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles, feeds } from "../db/schema";
import { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } from "../embedding";
import type { EmbeddingDedupResult } from "./types";
```

Function signature:

```typescript
export async function processPendingDedup(
  db: AppDatabase,
  embeddingModel: EmbeddingModel<string>,
  config: AppConfig,
  logger: Logger,
): Promise<EmbeddingDedupResult>
```

Logic:

1. **Query pending articles:** `db.select().from(articles).where(eq(articles.status, "pending_dedup")).all()`

2. **Early return** if no pending articles (return zero counts).

3. **For each pending article:**

   a. **Prepare text:** Call `prepareEmbeddingInput({ title: article.title, body: article.extractedText })`. Note: at this stage, `extractedText` may be null since fetch/extract haven't run yet. Use the title + whatever body text is available. If both are null/empty, skip embedding and transition directly to `pending_assessment`.

   b. **Generate embedding:** Call `generateEmbedding(embeddingModel, text)`.

   c. **Determine lookback window:** Look up the feed's `dedupLookbackDays` via `db.select({ dedupLookbackDays: feeds.dedupLookbackDays }).from(feeds).where(eq(feeds.id, article.feedId)).get()`. Use the per-feed value if set, otherwise fall back to `config.dedup.defaultLookbackDays`.

   d. **Load recent embeddings:** Query articles with non-null embeddings created within the lookback window. **Cross-feed comparison is intentional** — the whole point of embedding dedup is catching semantically identical articles from different feeds (e.g., the same press release appearing in both PRNewswire BizTech and Health feeds). The lookback window is determined by the *pending* article's feed config, and applied to filter *all* recent articles across all feeds:
   ```typescript
   const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
   const recentArticles = db
     .select({ id: articles.id, embedding: articles.embedding })
     .from(articles)
     .where(
       and(
         isNotNull(articles.embedding),
         gte(articles.createdAt, cutoff),
       ),
     )
     .all();
   ```

   e. **Compute similarity:** For each recent article, call `cosineSimilarity(newEmbedding, recentArticle.embedding)`. Track the maximum similarity found.

   f. **Decision:** If max similarity >= `config.dedup.similarityThreshold`, mark as `duplicate`. Otherwise, mark as `pending_assessment`.

   g. **Update atomically (AC2.2):** Use a single update that sets both the embedding and the new status:
   ```typescript
   db.update(articles)
     .set({
       embedding: Array.from(newEmbedding),
       status: isDuplicate ? "duplicate" : "pending_assessment",
     })
     .where(eq(articles.id, article.id))
     .run();
   ```

4. **Log results** and return `EmbeddingDedupResult`.

5. **Error handling per article:** Wrap each article's processing in try-catch. On failure, log warning and increment `failedCount`. Leave the article in `pending_dedup` for retry on next cycle (matching the assessor's retry pattern).

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(pipeline): implement batch embedding dedup processor`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Embedding dedup batch tests

**Verifies:** embedding-dedup.AC1.1, embedding-dedup.AC2.1, embedding-dedup.AC2.2, embedding-dedup.AC3.1, embedding-dedup.AC3.2, embedding-dedup.AC3.3, embedding-dedup.AC3.4

**Files:**
- Create: `src/pipeline/embedding-dedup.test.ts`

**Testing:**

Use in-memory SQLite via `createTestDatabase()`, `seedTestFeed()`, `seedTestArticle()` from `src/test-utils/db.ts`. Mock the embedding generation using `vi.mock("../embedding", ...)`.

Tests must verify each AC:

- **embedding-dedup.AC1.1:** `prepareEmbeddingInput` is called with the article's title and extractedText. Mock `generateEmbedding` to return a 768-dim vector. Verify the mock was called with the correct prepared text.

- **embedding-dedup.AC2.1:** After processing, the article's `embedding` column contains the generated embedding array (query DB to verify).

- **embedding-dedup.AC2.2:** Embedding and status are updated in the same operation. Verify that after `processPendingDedup` completes, the article has BOTH a non-null embedding AND a non-`pending_dedup` status. (No partial updates.)

- **embedding-dedup.AC3.1:** Seed a recent article with a known embedding. Insert a new `pending_dedup` article. Mock `generateEmbedding` to return a vector with cosine similarity >= 0.90 to the existing one. After processing, verify the new article has `status: "duplicate"`.

- **embedding-dedup.AC3.2:** Same setup but mock returns a dissimilar vector (cosine similarity < 0.90). Verify status transitions to `pending_assessment`.

- **embedding-dedup.AC3.3:** Seed an article with embedding but `createdAt` older than the lookback window. Insert a similar `pending_dedup` article. Verify the old article is NOT compared against (article passes as non-duplicate despite similar embedding).

- **embedding-dedup.AC3.4:** Seed a feed with `dedupLookbackDays: 5`. Seed an article with embedding and `createdAt` 10 days ago (outside per-feed window but inside default 15-day window). Verify the per-feed window is respected and the old article is excluded from comparison.

Additional edge case tests:
- No pending articles → returns zero counts
- Article with null title and null extractedText → transitions to `pending_assessment` without embedding
- Multiple pending articles processed in batch → each gets correct status

Follow project test patterns: `describe` / `it` blocks, `beforeEach` with fresh DB, `vi.mock()` for embedding module.

Create a test config using `createTestConfig()` from test-utils, adding the `dedup` section:
```typescript
const config = {
  ...createTestConfig(),
  dedup: { similarityThreshold: 0.9, defaultLookbackDays: 15 },
};
```

**Verification:**
Run: `npm test`
Expected: All tests pass

**Commit:** `test(pipeline): add embedding dedup batch tests`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Export processPendingDedup from pipeline barrel

**Files:**
- Modify: `src/pipeline/index.ts` (add exports)

**Implementation:**

Add to `src/pipeline/index.ts`:

```typescript
export { processPendingDedup } from "./embedding-dedup";
export type { EmbeddingDedupResult } from "./types";
```

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(pipeline): export processPendingDedup from barrel`
<!-- END_TASK_6 -->
