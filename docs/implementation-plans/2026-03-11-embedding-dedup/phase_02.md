# Embedding Dedup Implementation Plan

**Goal:** Create embedding generation client and cosine similarity utility using Vercel AI SDK + Ollama

**Architecture:** New `src/embedding/` module wrapping the Vercel AI SDK `embed()` function with the existing `ollama-ai-provider-v2` package. Follows the project's dependency injection pattern — functions take deps as params. Uses the SDK's built-in `cosineSimilarity()` utility.

**Tech Stack:** Vercel AI SDK (`ai` package), `ollama-ai-provider-v2`, TypeScript

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

### embedding-dedup.AC1: Embedding generation
- **embedding-dedup.AC1.1 Success:** New articles generate embeddings using title + first 1000 chars of body
- **embedding-dedup.AC1.2 Success:** Embeddings are 768-dimensional float arrays (qwen3-embedding:0.6b)

### embedding-dedup.AC2: Embedding storage
- **embedding-dedup.AC2.1 Success:** Embeddings stored as JSON array in articles.embedding column

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create embedding module types and text preparation utility

**Verifies:** embedding-dedup.AC1.1

**Files:**
- Create: `src/embedding/index.ts`

**Implementation:**

Create the embedding module barrel with:

1. A `prepareEmbeddingInput` pure function that concatenates title + first 1000 chars of body text. This is the text preparation step referenced in AC1.1.

```typescript
import { embed, cosineSimilarity } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { EmbeddingModel } from "ai";

export type EmbeddingInput = {
  readonly title: string | null;
  readonly body: string | null;
};

export function prepareEmbeddingInput(input: Readonly<EmbeddingInput>): string {
  const title = input.title ?? "";
  const body = (input.body ?? "").slice(0, 1000);
  return `${title}\n${body}`.trim();
}
```

2. A `createEmbeddingModel` factory that mirrors the existing `createOllama` pattern from `src/llm/providers.ts:8-10`:

```typescript
export function createEmbeddingModel(baseUrl?: string): EmbeddingModel<string> {
  const ollama = createOllama({
    baseURL: baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434",
  });
  return ollama.embeddingModel("qwen3-embedding:0.6b");
}
```

3. A `generateEmbedding` function that wraps the Vercel AI SDK `embed()` call:

```typescript
export async function generateEmbedding(
  model: EmbeddingModel<string>,
  text: string,
): Promise<ReadonlyArray<number>> {
  const result = await embed({ model, value: text });
  return result.embedding;
}
```

4. Re-export `cosineSimilarity` from the `ai` package so consumers import from `src/embedding`:

```typescript
export { cosineSimilarity } from "ai";
```

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(embedding): add embedding module with text prep, model factory, and generate function`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Embedding generation tests

**Verifies:** embedding-dedup.AC1.1, embedding-dedup.AC1.2

**Files:**
- Create: `src/embedding/index.test.ts`

**Testing:**

Tests must verify:
- **embedding-dedup.AC1.1:** `prepareEmbeddingInput` correctly concatenates title + first 1000 chars of body
  - Title only (null body) → returns title
  - Body only (null title) → returns first 1000 chars of body
  - Both title and body → returns `title\nbody` with body truncated at 1000 chars
  - Both null → returns empty string
  - Body exactly 1000 chars → no truncation
  - Body over 1000 chars → truncated to 1000

- **embedding-dedup.AC1.2:** `generateEmbedding` returns the embedding array from the SDK
  - Mock `embed` from `ai` package using `vi.mock("ai", ...)`
  - Mock should return `{ embedding: Array(768).fill(0.1) }`
  - Verify the function passes `model` and `value` to `embed()`
  - Verify it returns the embedding array directly

- **createEmbeddingModel:** Mock `createOllama` from `ollama-ai-provider-v2` using `vi.mock()`. Verify `createEmbeddingModel()` returns an embedding model without throwing. Verify `createEmbeddingModel("http://custom:11434")` passes the custom URL to `createOllama`.

Note: `cosineSimilarity` is a re-export from the `ai` package — don't re-test it.

Follow existing test patterns from the project:
- `describe` / `it` blocks with Vitest globals
- `vi.mock()` for external deps (see pattern in `src/llm/providers.test.ts`)
- Relative imports

**Verification:**
Run: `npm test`
Expected: All tests pass including new embedding tests

**Commit:** `test(embedding): add tests for text preparation and embedding generation`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create embedding CLAUDE.md

**Files:**
- Create: `src/embedding/CLAUDE.md`

**Implementation:**

Following the project convention (see `src/db/CLAUDE.md`, `src/llm/CLAUDE.md`), create contract documentation:

```markdown
# Embedding

Last verified: 2026-03-11

## Purpose
Generates text embeddings via Ollama for semantic deduplication. Wraps the Vercel AI SDK embedding API.

## Contracts
- **Exposes**: `createEmbeddingModel(baseUrl?) -> EmbeddingModel`, `generateEmbedding(model, text) -> number[]`, `prepareEmbeddingInput(input) -> string`, `cosineSimilarity` (re-export from ai)
- **Guarantees**: Text input truncated to title + first 1000 chars of body. Embedding dimension determined by model (768 for qwen3-embedding:0.6b).
- **Expects**: Ollama running with embedding model pulled. Base URL via param or OLLAMA_BASE_URL env var.

## Dependencies
- **Uses**: `ai` (Vercel AI SDK), `ollama-ai-provider-v2`
- **Used by**: `src/pipeline/dedup.ts`
- **Boundary**: This module generates embeddings; dedup logic lives in pipeline

## Key Files
- `index.ts` - All exports: model factory, embedding generation, text prep, cosine similarity re-export
```

**Commit:** `docs(embedding): add CLAUDE.md contract documentation`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
