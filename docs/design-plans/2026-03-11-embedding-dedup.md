# Embedding Dedup Design

## Summary

This design adds embedding-based deduplication to the RSS polling pipeline to catch duplicate articles that traditional GUID-based deduplication misses. When new articles arrive, the system generates 768-dimensional embeddings using Ollama's `qwen3-embedding:0.6b` model from the article title and first 1000 characters, then computes cosine similarity against recent articles within a configurable lookback window (default 15 days). Articles exceeding a 0.90 similarity threshold are marked as duplicates and skipped; the rest proceed to LLM assessment.

The implementation follows a trigger-based batch model: articles are stored with `pending_dedup` status, then a dedup job processes all pending articles after each poll cycle completes. This approach avoids blocking the poll while still providing near-real-time deduplication. The design intentionally degrades gracefully—if Ollama is unavailable, articles fall back to GUID-only deduplication rather than being lost.

## Definition of Done

**Deliverable:** Embedding-based deduplication layer in the RSS polling pipeline

**Success criteria:**
- New articles generate embeddings (title + first 1000 chars) via Ollama qwen3-embedding:0.6b
- Embeddings stored in SQLite `articles` table (JSON column)
- Pre-store similarity check against recent articles (default 15 days, per-feed configurable)
- Cosine similarity threshold: 0.90 (prefer allowing articles over blocking false positives)
- Fallback: If Ollama unavailable, skip embedding + store with GUID-only dedup
- Configurable via `config.yaml`: lookback days per feed, threshold global

**Out of scope:**
- Backfilling existing articles
- Vector search extensions (sqlite-vec, etc.)

## Acceptance Criteria

### embedding-dedup.AC1: Embedding generation
- **embedding-dedup.AC1.1 Success:** New articles generate embeddings using title + first 1000 chars of body
- **embedding-dedup.AC1.2 Success:** Embeddings are 768-dimensional float arrays (qwen3-embedding:0.6b)
- **embedding-dedup.AC1.3 Failure:** Ollama connection failure logs warning, article remains pending_dedup
- **embedding-dedup.AC1.4 Failure:** Invalid embedding response (wrong dimension) triggers retry, then fallback

### embedding-dedup.AC2: Embedding storage
- **embedding-dedup.AC2.1 Success:** Embeddings stored as JSON array in articles.embedding column
- **embedding-dedup.AC2.2 Success:** Embedding persisted within same transaction as status update

### embedding-dedup.AC3: Similarity-based deduplication
- **embedding-dedup.AC3.1 Success:** Articles with cosine similarity >= 0.90 marked as duplicate
- **embedding-dedup.AC3.2 Success:** Articles with similarity < 0.90 transition to pending_assessment
- **embedding-dedup.AC3.3 Success:** Comparison limited to articles within lookback window (default 15 days)
- **embedding-dedup.AC3.4 Success:** Per-feed lookback override respected when configured

### embedding-dedup.AC4: Fallback behavior
- **embedding-dedup.AC4.1 Success:** Ollama unavailable → articles skip embedding, use GUID-only dedup
- **embedding-dedup.AC4.2 Success:** Fallback articles still stored (no data loss)

### embedding-dedup.AC5: Configuration
- **embedding-dedup.AC5.1 Success:** similarityThreshold validates as 0-1 range at startup
- **embedding-dedup.AC5.2 Success:** lookbackDays validates as positive integer at startup
- **embedding-dedup.AC5.3 Success:** Per-feed dedupLookbackDays overrides global default

## Glossary

- **Embedding**: A dense numerical vector representation of text (768 dimensions in this design) that captures semantic meaning, enabling similarity comparisons between articles even when they don't share exact words.

- **Cosine similarity**: A metric ranging from -1 to 1 that measures the angle between two vectors; 1 means identical direction (highly similar), 0 means orthogonal (unrelated). The 0.90 threshold means articles must be very similar to be considered duplicates.

- **Ollama**: A self-hosted runtime for running small language models locally. Here it serves the `qwen3-embedding:0.6b` embedding model rather than using a cloud API.

- **Vercel AI SDK**: A unified TypeScript client library for interacting with multiple AI/LLM providers. The embedding client wraps this SDK to communicate with Ollama.

- **Drizzle ORM**: A TypeScript ORM used for database operations. Migrations are generated via `npm run db:generate` and applied with `npm run db:push`.

- **Functional Core / Imperative Shell**: An architectural pattern where business logic is pure and testable (functional core) while side effects like I/O are isolated at the boundaries (imperative shell).

- **Discriminated union**: A TypeScript pattern for modeling error states or variants with a type-safe tag field, enabling exhaustive checking and safer error handling than exceptions.

- **Batch deduplication**: Processing multiple articles together in a single job rather than checking each article individually as it arrives. This improves efficiency by sharing the cost of loading recent embeddings.

- **Lookback window**: The configurable time period (default 15 days) used to filter which recent articles should be compared against new arrivals. Older articles are excluded to keep comparisons tractable.

- **GUID-based deduplication**: The existing deduplication method using RSS feed item identifiers. This catches exact duplicates from the same feed but misses semantically identical articles from different sources.

## Architecture

Trigger-based batch deduplication flow:

```
RSS Poll → Parse Items → Store (status: pending_dedup)
                                      ↓
                            Trigger Dedup Job
                                      ↓
                    ┌──────────────────────────────┐
                    │ 1. Fetch all pending_dedup   │
                    │ 2. Generate embeddings batch │
                    │ 3. Load recent embeddings    │
                    │ 4. Compute similarity        │
                    │ 5. Update status             │
                    │    - duplicate (skip)        │
                    │    - pending_assessment      │
                    └──────────────────────────────┘
```

**Key components:**
- `src/pipeline/dedup.ts` — existing module, extended to handle batch flow
- `src/embedding/index.ts` — new module for Ollama embedding generation
- `articles` table gains `embedding` column (JSON) and `duplicate` status

**Trigger mechanism:**
- After poll completes, enqueue dedup job (in-process, not HTTP queue)
- Job runs once per poll cycle, processes all pending articles

## Existing Patterns

The pipeline already follows a functional core pattern with explicit status transitions (`pending_assessment` → `assessed` → digest). This design extends that pattern by introducing `pending_dedup` as the initial state, with embedding-based similarity checks before transitioning to `pending_assessment`.

Config structure follows existing YAML pattern with Zod validation at startup.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Schema Migration
**Goal:** Add embedding column and duplicate status to articles table

**Components:**
- `src/db/schema.ts` — add `embedding` column (JSON, optional), extend status enum
- Drizzle migration generation

**Dependencies:** None

**Done when:** `npm run db:generate` produces migration, `npm run db:push` applies successfully
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Embedding Client
**Goal:** Ollama embedding generation client

**Components:**
- `src/embedding/index.ts` — `generateEmbedding(text: string): Promise<number[]>` using Vercel AI SDK
- Cosine similarity utility function

**Dependencies:** Phase 1 (schema ready)

**Done when:** Embedding generation works against Ollama, returns 768-dimension vectors
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Config Extension
**Goal:** Add dedup configuration to config.yaml and Zod schema

**Components:**
- `src/config/` — extend config schema with `dedup.similarityThreshold`, `dedup.defaultLookbackDays`
- `config.yaml` — add per-feed `dedupLookbackDays` override option

**Dependencies:** None (can run in parallel with Phase 1-2)

**Done when:** Config loads and validates, environment variable overrides work
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Batch Dedup Logic
**Goal:** Rewrite dedup.ts for batch processing with embedding comparison

**Components:**
- `src/pipeline/dedup.ts` — batch fetch pending articles, generate embeddings, compute similarity, update status
- `src/pipeline/types.ts` — add `duplicate` to status types

**Dependencies:** Phases 1-3 (schema, embedding client, config)

**Done when:** Dedup job correctly identifies duplicates and updates statuses
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Poller Integration
**Goal:** Trigger dedup job after poll completes

**Components:**
- `src/pipeline/poller.ts` (or equivalent) — trigger batch dedup after storing new items

**Dependencies:** Phase 4 (dedup logic ready)

**Done when:** Full pipeline runs end-to-end: poll → store → dedup → pending_assessment
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Error Handling & Fallback
**Goal:** Handle Ollama failures gracefully

**Components:**
- `src/embedding/index.ts` — retry logic, fallback behavior
- Logging throughout dedup flow

**Dependencies:** Phase 4 (dedup logic ready)

**Done when:** Ollama failure doesn't lose articles, fallback to GUID-only dedup works
<!-- END_PHASE_6 -->

## Additional Considerations

**Embedding input:** Title + first 1000 chars of extracted body. This captures the lede without boilerplate drift.

**Error handling:** Ollama failures leave articles in `pending_dedup` status for retry on next cycle. Persistent failures can be monitored via logs.

**Performance:** O(n) similarity check against recent articles. For 1000 recent articles and 10 new articles, that's 10,000 comparisons — trivial for cosine similarity in TypeScript.

---
