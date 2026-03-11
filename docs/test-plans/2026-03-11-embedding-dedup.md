# Embedding Dedup — Human Test Plan

Generated: 2026-03-11

## Prerequisites

- Application deployed to container machine (`giulia@container-machine:3002`)
- Ollama running at `192.168.1.6:11434` with `qwen3-embedding:0.6b` pulled
- At least one RSS feed configured and producing new articles
- `npm test` passing (264/264)
- SQLite DB accessible via `sqlite3` CLI or equivalent

## Phase 1: Embedding Dimension Verification (AC1.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | SSH into container machine | Connected |
| 2 | Trigger a poll cycle: `curl -X POST http://localhost:3002/api/poll` | 200 OK response |
| 3 | Wait 30-60 seconds for the pipeline to process articles through embedding dedup | -- |
| 4 | Query the database: `sqlite3 data/horizon-scan.db "SELECT id, json_array_length(embedding) as dims FROM articles WHERE embedding IS NOT NULL LIMIT 10;"` | All rows show `dims = 768` |
| 5 | Spot-check one embedding value: `sqlite3 data/horizon-scan.db "SELECT substr(embedding, 1, 100) FROM articles WHERE embedding IS NOT NULL LIMIT 1;"` | JSON array of float values (e.g., `[0.0123, -0.456, ...]`) |

## Phase 2: Transactional Atomicity Verification (AC2.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Code review: open `src/pipeline/embedding-dedup.ts` | Locate the update statement |
| 2 | Confirm the embedding and status fields are set in a single `db.update(articles).set({ embedding, status }).where(...)` call | Single `.set()` call with both fields, not two separate update statements |
| 3 | Verify no intermediate `db.update()` call sets embedding without status or vice versa | No partial update paths exist |

## Phase 3: Ollama Unavailable Fallback (AC4.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Stop the application if running | -- |
| 2 | Set `OLLAMA_BASE_URL=http://192.168.1.99:11434` (unreachable host) in `.env` | -- |
| 3 | Start the application: `npm start` | Application starts without crashing |
| 4 | Check startup logs for embedding model init failure: search for `"embedding model init failed"` or `"embedding dedup disabled"` | Log message present at warn/info level |
| 5 | Trigger a poll cycle: `curl -X POST http://localhost:3002/api/poll` | 200 OK |
| 6 | Query articles that were in `pending_dedup`: `sqlite3 data/horizon-scan.db "SELECT id, status, embedding FROM articles WHERE status = 'pending_dedup';"` | Zero rows (none stuck in `pending_dedup`) |
| 7 | Verify articles moved forward: `sqlite3 data/horizon-scan.db "SELECT id, status, embedding FROM articles ORDER BY createdAt DESC LIMIT 10;"` | Articles show `pending_assessment` or later status; `embedding` is NULL for articles processed during this test |
| 8 | Restore `OLLAMA_BASE_URL` to correct value (`http://192.168.1.6:11434`) | -- |

## End-to-End: Full Dedup Pipeline

**Purpose:** Validate that a newly polled article flows through embedding generation, similarity comparison, and status transition without manual intervention.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure Ollama is reachable and application is running with correct config | -- |
| 2 | Note current max article ID: `sqlite3 data/horizon-scan.db "SELECT MAX(id) FROM articles;"` | Record value (e.g., 42) |
| 3 | Trigger poll: `curl -X POST http://localhost:3002/api/poll` | 200 OK |
| 4 | Wait 60 seconds for pipeline completion | -- |
| 5 | Check new articles: `sqlite3 data/horizon-scan.db "SELECT id, status, embedding IS NOT NULL as has_emb, embeddingRetryCount FROM articles WHERE id > 42;"` | New articles show `status` of `pending_assessment`, `duplicate`, or later; `has_emb = 1` for non-duplicate articles; `embeddingRetryCount = 0` for successful embeddings |
| 6 | Verify duplicates were caught: `sqlite3 data/horizon-scan.db "SELECT COUNT(*) FROM articles WHERE status = 'duplicate' AND id > 42;"` | Count >= 0 (may be 0 if no duplicates exist; non-zero if feed has republished content) |

## End-to-End: Retry Exhaustion Path

**Purpose:** Confirm that articles failing embedding generation 3 times eventually fall through to assessment.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Manually insert a test article stuck in retry: `sqlite3 data/horizon-scan.db "INSERT INTO articles (feedId, guid, url, title, status, embeddingRetryCount, createdAt) VALUES (1, 'test-retry-exhaust', 'http://test', 'Retry Test', 'pending_dedup', 2, datetime('now'));"` | Row inserted |
| 2 | Temporarily make Ollama unreachable (stop ollama or change base URL) | -- |
| 3 | Trigger poll: `curl -X POST http://localhost:3002/api/poll` | 200 OK |
| 4 | Check article: `sqlite3 data/horizon-scan.db "SELECT status, embeddingRetryCount, embedding FROM articles WHERE guid = 'test-retry-exhaust';"` | `embeddingRetryCount = 3`, `status = pending_dedup` (third failure) or `status = pending_assessment` if fallback logic runs in same cycle |
| 5 | Trigger another poll cycle | 200 OK |
| 6 | Re-check: same query as step 4 | `status = pending_assessment`, `embedding IS NULL` |
| 7 | Restore Ollama connectivity | -- |
| 8 | Clean up: `sqlite3 data/horizon-scan.db "DELETE FROM articles WHERE guid = 'test-retry-exhaust';"` | -- |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC1.2: 768-dim embeddings | Automated tests mock the SDK; only a live `qwen3-embedding:0.6b` model confirms actual dimension output | Phase 1 above |
| AC2.2: Transactional atomicity | Integration tests verify end state but cannot prove crash-safety; requires code review of the update call | Phase 2 above |
| AC4.1: Startup with unreachable Ollama | Automated tests mock the embedding model as null; full startup path with network failure requires live environment | Phase 3 above |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1: Embedding input prep | `src/embedding/index.test.ts` (6 tests) + `src/pipeline/embedding-dedup.test.ts` (2 tests) | -- |
| AC1.2: 768-dim embeddings | `src/embedding/index.test.ts` (3 tests) | Phase 1: DB query for `json_array_length` |
| AC1.3: Connection failure retry | `src/pipeline/embedding-dedup.test.ts` (2 tests) | -- |
| AC1.4: Dimension mismatch retry + fallback | `src/pipeline/embedding-dedup.test.ts` (2 tests) | -- |
| AC2.1: Embedding stored as JSON | `src/pipeline/embedding-dedup.test.ts` (1 test) | -- |
| AC2.2: Atomic update | `src/pipeline/embedding-dedup.test.ts` (1 test) | Phase 2: Code review |
| AC3.1: Similarity >= 0.90 duplicate | `src/pipeline/embedding-dedup.test.ts` (1 test) | -- |
| AC3.2: Similarity < 0.90 passes | `src/pipeline/embedding-dedup.test.ts` (1 test) | -- |
| AC3.3: Lookback window | `src/pipeline/embedding-dedup.test.ts` (1 test) | -- |
| AC3.4: Per-feed lookback | `src/pipeline/embedding-dedup.test.ts` (1 test) | -- |
| AC4.1: Fallback dedup | `src/pipeline/embedding-dedup.test.ts` (3 tests) + `src/scheduler.test.ts` (2 tests) | Phase 3: Unreachable Ollama startup |
| AC4.2: No data loss | `src/pipeline/embedding-dedup.test.ts` (2 tests) | E2E: Retry exhaustion path |
| AC5.1: similarityThreshold validation | `src/config/schema.test.ts` (8 tests) | -- |
| AC5.2: lookbackDays validation | `src/config/schema.test.ts` (8 tests) | -- |
| AC5.3: Per-feed dedupLookbackDays | `src/config/schema.test.ts` (3 tests) | -- |
