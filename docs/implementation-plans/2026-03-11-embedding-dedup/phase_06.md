# Embedding Dedup Implementation Plan

**Goal:** Handle Ollama failures gracefully with retry logic and fallback to GUID-only dedup

**Architecture:** When embedding generation fails for an article, the article stays in `pending_dedup` status for retry on the next poll cycle. After a configurable max retry count, the article falls back to GUID-only dedup by transitioning directly to `pending_assessment` without an embedding. This matches the existing retry patterns in `fetchPendingArticles` (max 3 fetch retries) and `assessPendingArticles` (max 3 assessment retries). When the embedding model is entirely unavailable (null at startup), all articles skip embedding dedup and go straight to `pending_assessment`.

**Tech Stack:** TypeScript, Drizzle ORM, pino logging

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

### embedding-dedup.AC1: Embedding generation
- **embedding-dedup.AC1.3 Failure:** Ollama connection failure logs warning, article remains pending_dedup
- **embedding-dedup.AC1.4 Failure:** Invalid embedding response (wrong dimension) triggers retry, then fallback

### embedding-dedup.AC4: Fallback behavior
- **embedding-dedup.AC4.1 Success:** Ollama unavailable → articles skip embedding, use GUID-only dedup
- **embedding-dedup.AC4.2 Success:** Fallback articles still stored (no data loss)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add embeddingRetryCount column to articles table

**Files:**
- Modify: `src/db/schema.ts` (add column to articles table, after `assessmentRetryCount`)
- Generated: `drizzle/0003_*.sql` (migration)

**Implementation:**

Add to the articles table in `src/db/schema.ts`, after `assessmentRetryCount` (line 49):

```typescript
embeddingRetryCount: integer("embedding_retry_count").notNull().default(0),
```

This follows the exact pattern of `fetchRetryCount` and `assessmentRetryCount`.

**Step 1:** Add the column
**Step 2:** Generate migration: `npm run db:generate`
**Step 3:** Apply migration: `npm run db:push`
**Step 4:** Run tests: `npm test`

**Commit:** `feat(db): add embeddingRetryCount column to articles`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add retry and fallback logic to processPendingDedup

**Verifies:** embedding-dedup.AC1.3, embedding-dedup.AC1.4, embedding-dedup.AC4.1, embedding-dedup.AC4.2

**Files:**
- Modify: `src/pipeline/embedding-dedup.ts`

**Implementation:**

Update the `processPendingDedup` function to handle failures:

1. **Query filter:** Add `lt(articles.embeddingRetryCount, MAX_EMBEDDING_RETRIES)` to the pending articles query (where `MAX_EMBEDDING_RETRIES = 3`). This prevents endlessly retrying articles that consistently fail.

2. **Per-article error handling** (already partially described in Phase 4 Task 4): When `generateEmbedding` throws:
   - Log a warning with the article ID and error message
   - Increment `embeddingRetryCount`: `db.update(articles).set({ embeddingRetryCount: sql\`embedding_retry_count + 1\` }).where(eq(articles.id, article.id)).run()`
   - Leave status as `pending_dedup` for retry next cycle
   - Increment `failedCount` in result

3. **Fallback after max retries:** Query articles that have `pending_dedup` status AND `embeddingRetryCount >= MAX_EMBEDDING_RETRIES`. For these, transition directly to `pending_assessment` without embedding (GUID-only dedup). Log info message per article.

4. **Embedding dimension validation (AC1.4):** After `generateEmbedding` returns, check `embedding.length`. If it's not 768, treat it as a failure (same as Ollama connection error — log warning, increment retry count). This can be a simple check:
   ```typescript
   const EXPECTED_EMBEDDING_DIM = 768;
   if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
     logger.warn(
       { articleId: article.id, actual: embedding.length, expected: EXPECTED_EMBEDDING_DIM },
       "embedding dimension mismatch, retrying",
     );
     // increment retry count, continue
   }
   ```

5. **Null embedding model (AC4.1):** Already handled in Phase 5 — `runPollCycle` skips the entire `processPendingDedup` call when `embeddingModel` is null. But we also need a **startup fallback**: when the embedding model is null, any existing `pending_dedup` articles from a previous cycle won't get processed. Add a `fallbackPendingDedup` function that transitions all `pending_dedup` articles directly to `pending_assessment`. Call this in `runPollCycle` when `embeddingModel` is null:

   ```typescript
   if (pipeline?.embeddingModel) {
     // ... processPendingDedup call
   } else {
     // Fallback: transition any pending_dedup articles without embedding
     fallbackPendingDedup(db, logger);
   }
   ```

   The `fallbackPendingDedup` function:
   ```typescript
   export function fallbackPendingDedup(db: AppDatabase, logger: Logger): void {
     const result = db
       .update(articles)
       .set({ status: "pending_assessment" })
       .where(eq(articles.status, "pending_dedup"))
       .run();

     if (result.changes > 0) {
       logger.info(
         { count: result.changes },
         "fallback: transitioned pending_dedup articles to pending_assessment (no embedding model)",
       );
     }
   }
   ```

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(dedup): add retry logic, fallback, and dimension validation`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Error handling and fallback tests

**Verifies:** embedding-dedup.AC1.3, embedding-dedup.AC1.4, embedding-dedup.AC4.1, embedding-dedup.AC4.2

**Files:**
- Modify: `src/pipeline/embedding-dedup.test.ts` (add test cases to existing file from Phase 4)

**Testing:**

Add new test cases to the existing test file:

- **embedding-dedup.AC1.3:** Mock `generateEmbedding` to throw an error. After `processPendingDedup`, verify:
  - Article status remains `pending_dedup`
  - `embeddingRetryCount` incremented by 1
  - Warning logged (use `createTestLoggerWithCapture` from test-utils)
  - `failedCount` in result is 1

- **embedding-dedup.AC1.4:** Mock `generateEmbedding` to return a vector with wrong dimensions (e.g., 512 instead of 768). Verify same retry behaviour as AC1.3.

- **embedding-dedup.AC4.1 (fallback function):** Insert articles with `pending_dedup` status. Call `fallbackPendingDedup(db, logger)`. Verify all articles transition to `pending_assessment` with no embedding set.

- **embedding-dedup.AC4.2:** After retry failures, article with `embeddingRetryCount >= 3` should be transitioned to `pending_assessment` on next cycle (no data loss). Seed article with `embeddingRetryCount: 3` and `status: "pending_dedup"`. Run `processPendingDedup`. Verify article transitions to `pending_assessment` without embedding.

- **Max retries respected:** Seed article with `embeddingRetryCount: 3`. Verify it's NOT passed to `generateEmbedding` (it should be caught by the fallback, not the retry loop).

**Verification:**
Run: `npm test`
Expected: All tests pass

**Commit:** `test(dedup): add error handling, retry, and fallback tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update pipeline and scheduler documentation

**Files:**
- Modify: `src/pipeline/CLAUDE.md`
- Modify: `src/scheduler.ts` (update JSDoc comments if not done in Phase 5)

**Implementation:**

Update `src/pipeline/CLAUDE.md`:
- Add embedding dedup as a pipeline stage between Dedup and Fetch
- Update the Pipeline Stages section to include: `2.5 **Embedding Dedup** (embedding-dedup.ts): Batch embedding generation + cosine similarity dedup`
- Add to Invariants: `Embedding retry max: 3. Articles exceeding this fall back to GUID-only dedup`
- Add to Contracts/Exposes: `processPendingDedup`, `fallbackPendingDedup`
- Update Dependencies/Uses: add `src/embedding` (embedding generation)

**Commit:** `docs(pipeline): update CLAUDE.md with embedding dedup stage`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update scheduler to call fallbackPendingDedup and export it

**Files:**
- Modify: `src/scheduler.ts` (update the else branch for embedding dedup)
- Modify: `src/pipeline/index.ts` (export fallbackPendingDedup)

**Implementation:**

1. In `src/scheduler.ts`, import `fallbackPendingDedup`:
```typescript
import { processPendingDedup, fallbackPendingDedup } from "./pipeline/embedding-dedup";
```

2. Update the embedding dedup section in `runPollCycle` to include the fallback:
```typescript
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
```

3. Export `fallbackPendingDedup` from `src/pipeline/index.ts`.

**Verification:**
Run: `npm test`
Expected: All tests pass

**Commit:** `feat(scheduler): add fallback dedup when embedding model unavailable`
<!-- END_TASK_5 -->
