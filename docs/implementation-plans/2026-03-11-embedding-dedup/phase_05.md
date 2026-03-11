# Embedding Dedup Implementation Plan

**Goal:** Integrate embedding dedup into the poll cycle and startup sequence

**Architecture:** Add the embedding model to `PipelineDeps`, create it at startup (similar to LLM model), and insert `processPendingDedup` call into `runPollCycle` between the GUID dedup stage and the fetch stage. The embedding model follows the same nullable pattern as the LLM model — if Ollama is unavailable at startup, the embedding dedup stage is skipped.

**Tech Stack:** Vercel AI SDK, ollama-ai-provider-v2, TypeScript

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

This phase wires together components from previous phases. No new ACs are introduced, but the integration enables end-to-end pipeline flow required by all ACs.

**Verifies: None** (integration/wiring phase, verified by existing + Phase 4 tests passing end-to-end)

---

<!-- START_TASK_1 -->
### Task 1: Add embeddingModel to PipelineDeps and runPollCycle

**Files:**
- Modify: `src/scheduler.ts:5-6` (imports), `src/scheduler.ts:21-23` (PipelineDeps type), `src/scheduler.ts:84-91` (add dedup stage)

**Implementation:**

1. Add imports at the top of `src/scheduler.ts`:

```typescript
import type { EmbeddingModel } from "ai";
import { processPendingDedup } from "./pipeline/embedding-dedup";
```

2. Extend the `PipelineDeps` type (line 21-23):

```typescript
export type PipelineDeps = {
  readonly model: LanguageModel | null;
  readonly embeddingModel: EmbeddingModel<string> | null;
};
```

3. Insert the embedding dedup stage in `runPollCycle` after the feed polling loop (line 84) and before the fetch stage (line 86). Follow the exact same try-catch pattern used by the other stages:

```typescript
if (pipeline?.embeddingModel) {
  try {
    await processPendingDedup(db, pipeline.embeddingModel, config, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "embedding dedup stage failed");
  }
}
```

This mirrors the LLM model null-check pattern at line 100: `if (pipeline?.model)`.

4. Update the JSDoc comment at line 27 to reflect the new stage: `poll → dedup → embedding-dedup → fetch → extract → assess`.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(scheduler): integrate embedding dedup stage into poll cycle`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create embedding model at startup and pass to scheduler

**Files:**
- Modify: `src/index.ts:9` (add import), `src/index.ts:48-61` (add embedding model init), `src/index.ts:63` (pass to scheduler)

**Implementation:**

1. Add import at the top of `src/index.ts`:

```typescript
import { createEmbeddingModel } from "./embedding";
```

2. After the LLM client initialization block (line 61), add embedding model creation. Follow the same soft-failure pattern:

```typescript
let embeddingModel = null;
try {
  embeddingModel = createEmbeddingModel();
  logger.info("embedding model initialised");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(
    { error: message },
    "embedding model init failed, embedding dedup disabled",
  );
}
```

3. Update the `createPollScheduler` call (line 63) to include the embedding model:

```typescript
const pollScheduler = createPollScheduler(db, config, logger, {
  model,
  embeddingModel,
});
```

4. Update the `createApiServer` call (line 89) — if it receives `PipelineDeps` or model, include `embeddingModel` in the context. Check if the API server needs it; if not, no change needed there.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(startup): create embedding model and pass to poll scheduler`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add embeddingModel to API context and manual poll trigger

**Files:**
- Modify: `src/api/context.ts:2,12-17` (add EmbeddingModel import and field to AppContext)
- Modify: `src/api/routers/system.ts:42-44` (add embeddingModel to PipelineDeps in triggerPoll)
- Modify: `src/index.ts:89` (pass embeddingModel to createApiServer)
- Modify: `src/test-utils/db.ts:193` (add embeddingModel to createTestCaller context)

**Implementation:**

1. In `src/api/context.ts`, add the import and field:

```typescript
import type { EmbeddingModel } from "ai";
```

Add to `AppContext` type:
```typescript
export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly model: LanguageModel | null;
  readonly embeddingModel: EmbeddingModel<string> | null;
};
```

2. In `src/index.ts:89`, update the `createApiServer` call:

```typescript
const app = createApiServer({ db, config, logger, model, embeddingModel });
```

3. In `src/api/routers/system.ts:42-44`, update the `triggerPoll` mutation:

```typescript
triggerPoll: publicProcedure.mutation(async ({ ctx }) => {
  await runPollCycle(ctx.db, ctx.config, ctx.logger, {
    model: ctx.model,
    embeddingModel: ctx.embeddingModel,
  });
  return { triggered: true };
}),
```

4. In `src/test-utils/db.ts:193`, update `createTestCaller`:

```typescript
return createCaller({ db, config, logger, model: null, embeddingModel: null });
```

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

Run: `npm test`
Expected: All tests pass

**Commit:** `feat(api): add embeddingModel to API context and manual poll trigger`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update scheduler tests for new PipelineDeps shape

**Files:**
- Modify: `src/scheduler.test.ts` (if exists — update PipelineDeps mocks to include embeddingModel)

**Implementation:**

Any existing tests that construct `PipelineDeps` or pass `{ model }` to the scheduler need to also include `embeddingModel: null` (or a mock). Search for `PipelineDeps` and `{ model` in test files and update them.

If no scheduler tests exist, this task is a no-op — verify by running tests.

**Verification:**
Run: `npm test`
Expected: All tests pass

**Commit:** `test(scheduler): update pipeline deps for embedding model`
<!-- END_TASK_4 -->
