# Test Requirements

## Automated Tests

### embedding-dedup.AC1: Embedding generation

#### AC1.1 Success: New articles generate embeddings using title + first 1000 chars of body

- **Test type:** Unit
- **Test file:** `src/embedding/index.test.ts`
- **Tests:**
  - `prepareEmbeddingInput` with title only (null body) returns title
  - `prepareEmbeddingInput` with body only (null title) returns first 1000 chars of body
  - `prepareEmbeddingInput` with both title and body returns `title\nbody` with body truncated at 1000 chars
  - `prepareEmbeddingInput` with both null returns empty string
  - `prepareEmbeddingInput` with body exactly 1000 chars does not truncate
  - `prepareEmbeddingInput` with body over 1000 chars truncates to 1000

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - `processPendingDedup` calls `prepareEmbeddingInput` with the article's title and extractedText
  - Article with null title and null extractedText transitions to `pending_assessment` without embedding generation

#### AC1.2 Success: Embeddings are 768-dimensional float arrays

- **Test type:** Unit
- **Test file:** `src/embedding/index.test.ts`
- **Tests:**
  - `generateEmbedding` returns the embedding array from the mocked Vercel AI SDK `embed()` call
  - Mock returns a 768-dimensional array; verify the function passes `model` and `value` to `embed()` and returns the embedding directly

#### AC1.3 Failure: Ollama connection failure logs warning, article remains pending_dedup

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Mock `generateEmbedding` to throw a connection error; verify article status remains `pending_dedup`
  - Verify `embeddingRetryCount` is incremented by 1 after failure
  - Verify `failedCount` in `EmbeddingDedupResult` is 1
  - Verify a warning is logged with article ID and error message

#### AC1.4 Failure: Invalid embedding response (wrong dimension) triggers retry, then fallback

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Mock `generateEmbedding` to return a 512-dimensional vector; verify same retry behaviour as AC1.3 (status remains `pending_dedup`, retry count incremented)
  - Seed article with `embeddingRetryCount: 2`, mock returns wrong dimension; after processing, retry count is 3 and status is still `pending_dedup`
  - On next cycle, article with `embeddingRetryCount >= 3` falls back: transitions to `pending_assessment` without embedding (verified via DB query)

---

### embedding-dedup.AC2: Embedding storage

#### AC2.1 Success: Embeddings stored as JSON array in articles.embedding column

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - After `processPendingDedup` processes a non-duplicate article, query the DB and verify `articles.embedding` contains the generated embedding as a JSON array of numbers

#### AC2.2 Success: Embedding persisted within same transaction as status update

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - After `processPendingDedup` completes, verify the article has BOTH a non-null embedding AND a non-`pending_dedup` status (no partial updates where embedding is set but status is stale, or vice versa)

---

### embedding-dedup.AC3: Similarity-based deduplication

#### AC3.1 Success: Articles with cosine similarity >= 0.90 marked as duplicate

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Seed a recent article with a known embedding vector. Insert a new `pending_dedup` article. Mock `generateEmbedding` to return a vector with cosine similarity >= 0.90 to the existing one. After `processPendingDedup`, verify the new article has `status: "duplicate"`
  - Verify `duplicateCount` in `EmbeddingDedupResult` is 1

#### AC3.2 Success: Articles with similarity < 0.90 transition to pending_assessment

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Same setup as AC3.1 but mock returns a dissimilar vector (cosine similarity < 0.90). Verify the new article has `status: "pending_assessment"`
  - Verify `passedCount` in `EmbeddingDedupResult` is 1

#### AC3.3 Success: Comparison limited to articles within lookback window

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Seed an article with a known embedding and `createdAt` older than the default 15-day lookback window (e.g., 20 days ago). Insert a new `pending_dedup` article with a highly similar embedding. Verify the old article is NOT compared against: the new article transitions to `pending_assessment` despite having a similar embedding to the expired article

#### AC3.4 Success: Per-feed lookback override respected when configured

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Seed a feed with `dedupLookbackDays: 5`. Seed an article on that feed with a known embedding and `createdAt` 10 days ago (outside the 5-day per-feed window but inside the 15-day global default). Insert a new `pending_dedup` article on the same feed with a similar embedding. Verify the per-feed window is respected: the 10-day-old article is excluded from comparison and the new article transitions to `pending_assessment`

---

### embedding-dedup.AC4: Fallback behaviour

#### AC4.1 Success: Ollama unavailable -> articles skip embedding, use GUID-only dedup

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - Insert articles with `pending_dedup` status. Call `fallbackPendingDedup(db, logger)`. Verify all articles transition to `pending_assessment` with no embedding set (embedding column remains null)
  - Verify info message logged with count of transitioned articles

- **Test type:** Integration
- **Test file:** `src/scheduler.test.ts`
- **Tests:**
  - When `embeddingModel` is null in `PipelineDeps`, verify `fallbackPendingDedup` is called instead of `processPendingDedup` (articles in `pending_dedup` are transitioned to `pending_assessment`)

#### AC4.2 Success: Fallback articles still stored (no data loss)

- **Test type:** Integration
- **Test file:** `src/pipeline/embedding-dedup.test.ts`
- **Tests:**
  - After retry failures exhaust max retries (`embeddingRetryCount >= 3`), seed article with `embeddingRetryCount: 3` and `status: "pending_dedup"`. Run `processPendingDedup`. Verify article transitions to `pending_assessment` without embedding — article row still exists in DB with all original data intact (title, body, feedId, etc.)
  - After `fallbackPendingDedup`, verify articles still have all their original fields (title, extractedText, feedId, metadata) — only status changed

---

### embedding-dedup.AC5: Configuration

#### AC5.1 Success: similarityThreshold validates as 0-1 range at startup

- **Test type:** Unit
- **Test file:** `src/config/schema.test.ts`
- **Tests:**
  - Valid values: 0, 0.5, 0.9, 1 all parse without error via `appConfigSchema.parse()`
  - Invalid values: -0.1 and 1.1 fail Zod validation (safeParse returns `success: false`)
  - Default: omitting `dedup` section entirely results in `similarityThreshold` defaulting to 0.9

#### AC5.2 Success: lookbackDays validates as positive integer at startup

- **Test type:** Unit
- **Test file:** `src/config/schema.test.ts`
- **Tests:**
  - Valid values: 1, 15, 30 all parse without error
  - Invalid values: 0, -1, 1.5 fail Zod validation
  - Default: omitting `dedup` section entirely results in `defaultLookbackDays` defaulting to 15

#### AC5.3 Success: Per-feed dedupLookbackDays overrides global default

- **Test type:** Unit
- **Test file:** `src/config/schema.test.ts`
- **Tests:**
  - Feed config with `dedupLookbackDays: 7` parses correctly
  - Feed config without `dedupLookbackDays` results in the field being `undefined` (runtime uses global default)

---

## Human Verification

### AC1.2: Embeddings are 768-dimensional float arrays

**Why partial automation:** Unit tests verify the embedding client returns whatever the Vercel AI SDK produces, but confirming the actual `qwen3-embedding:0.6b` model returns 768 dimensions requires a live Ollama instance with the model pulled.

**Manual verification:** Run the application against a live Ollama instance. Trigger a poll cycle with at least one new article. Query the database and verify the `embedding` column contains a JSON array of exactly 768 float values:

```sql
SELECT id, json_array_length(embedding) FROM articles WHERE embedding IS NOT NULL LIMIT 5;
```

Expected: all rows return 768.

### AC2.2: Embedding persisted within same transaction as status update

**Why partial automation:** The integration test verifies the end state (both embedding and status are set), but cannot directly prove transactional atomicity — a crash between two separate statements would be undetectable in a test that runs to completion.

**Manual verification:** Code review of `processPendingDedup` to confirm the embedding and status are set in a single `db.update().set({ embedding, status }).run()` call, not two separate updates.

### AC4.1: Ollama unavailable -> articles skip embedding, use GUID-only dedup

**Why partial automation:** The scheduler integration test verifies `fallbackPendingDedup` is called when the embedding model is null. However, the full startup scenario — Ollama being unreachable during `createEmbeddingModel()`, causing `embeddingModel` to be null — requires a live environment test.

**Manual verification:** Start the application with `OLLAMA_BASE_URL` pointing to an unreachable host. Verify:
1. Startup log contains `"embedding model init failed, embedding dedup disabled"`
2. Poll cycle processes articles through the pipeline without embedding dedup
3. Articles reach `pending_assessment` status (not stuck in `pending_dedup`)
