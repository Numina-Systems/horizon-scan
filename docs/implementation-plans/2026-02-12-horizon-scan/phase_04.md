# Horizon Scan Implementation Plan — Phase 4: LLM Assessment

**Goal:** Assess extracted articles against user-defined topics using Vercel AI SDK with multi-provider support, producing structured output (relevant/not-relevant + summary + entity tags) validated by Zod schema.

**Architecture:** The assessor iterates pending articles, constructs a prompt with article text + topic description, calls the configured LLM provider via Vercel AI SDK's `generateText()` with `Output.object()` for Zod-validated structured output. A provider factory maps config to AI SDK provider instances. Assessment results are stored in the `assessments` table.

**Tech Stack:** ai (Vercel AI SDK 6.x), @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, ollama-ai-provider-v2, @ai-sdk/openai-compatible, Zod 3.x

**Scope:** 8 phases from original design (phases 1-8). This is phase 4.

**Codebase verified:** 2026-02-12 — Greenfield project. Phase 1 provides database schema (assessments table, topics table), config system (AppConfig with llm.provider and llm.model). Phase 3 provides articles with extractedText. Zod pinned to ^3.23.0 in Phase 1 for AI SDK compatibility.

**Design deviations:**
- **Ollama provider:** Design specifies `ai-sdk-ollama`. This plan uses `ollama-ai-provider-v2` instead — it has fewer dependencies, is web-compatible, and has simpler integration with Vercel AI SDK v6.
- **Z.ai provider:** Design specifies `zhipu-ai-provider`. This plan uses `@ai-sdk/openai-compatible` pointed at BigModel API instead — Z.ai's API is OpenAI-compatible, so a dedicated provider package is unnecessary and adds a dependency that may lag behind SDK updates.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC2: LLM relevance assessment
- **horizon-scan.AC2.1 Success:** Each new article is assessed against every active topic, producing a binary relevant/not-relevant result
- **horizon-scan.AC2.2 Success:** Relevant articles include a 2-3 sentence summary and extracted entity tags
- **horizon-scan.AC2.3 Success:** Assessment returns structured output matching the Zod schema (`{ relevant, summary, tags }`)
- **horizon-scan.AC2.4 Failure:** LLM call failure (rate limit, timeout, invalid response) leaves article as `pending_assessment` and retries up to 3 times before marking `failed`
- **horizon-scan.AC2.5 Success:** Switching LLM provider requires only a config file change (provider + model), no code changes

---

<!-- START_TASK_1 -->
### Task 1: Add AI SDK dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run: `npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/openai-compatible ollama-ai-provider-v2`

This adds:
- `ai` — Vercel AI SDK core (v6.x)
- `@ai-sdk/anthropic` — Anthropic (Claude) provider
- `@ai-sdk/openai` — OpenAI provider
- `@ai-sdk/google` — Google (Gemini) provider
- `@ai-sdk/openai-compatible` — for LM Studio and Z.ai (OpenAI-compatible endpoints)
- `ollama-ai-provider-v2` — Ollama local LLM provider (minimal deps, web-compatible)

> **Note:** `ollama-ai-provider-v2` is preferred over `ai-sdk-ollama` for simpler integration with fewer dependencies. Both are community providers.

**Step 2: Verify**

Run: `npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vercel ai sdk and provider dependencies"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: LLM provider factory

**Verifies:** horizon-scan.AC2.5

**Files:**
- Create: `src/llm/providers.ts`
- Create: `src/llm/client.ts`

The provider factory maps the config's `llm.provider` and `llm.model` to a Vercel AI SDK `LanguageModel` instance. Switching providers requires only a config change — no code changes (AC2.5).

**Implementation:**

`src/llm/providers.ts` — provider registration:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
});

const lmstudio = createOpenAICompatible({
  name: "lmstudio",
  baseURL: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
});

const zai = createOpenAICompatible({
  name: "zai",
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.ZAI_API_KEY,
});

type ProviderName =
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "lmstudio"
  | "zai";

export function getModel(provider: ProviderName, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "openai":
      return openai(modelId);
    case "gemini":
      return google(modelId);
    case "ollama":
      return ollama(modelId);
    case "lmstudio":
      return lmstudio(modelId);
    case "zai":
      return zai(modelId);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
```

`src/llm/client.ts` — thin wrapper using config:

```typescript
import type { LanguageModel } from "ai";
import type { AppConfig } from "../config";
import { getModel } from "./providers";

export function createLlmClient(config: AppConfig): LanguageModel {
  return getModel(config.llm.provider, config.llm.model);
}
```

Key behaviours:
- Exhaustive switch with `never` check ensures all providers are handled
- Environment variables for API keys follow AI SDK conventions (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- Ollama and LM Studio use configurable base URLs from env vars
- Z.ai uses OpenAI-compatible adapter pointed at BigModel API

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add multi-provider llm factory with six providers`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: LLM provider factory tests

**Verifies:** horizon-scan.AC2.5

**Files:**
- Test: `src/llm/providers.test.ts` (unit)

**Testing:**

- **horizon-scan.AC2.5 (all providers):** `getModel` returns a `LanguageModel` instance for each of the six providers: anthropic, openai, gemini, ollama, lmstudio, zai. Verify the returned object is truthy and has the expected interface (it's an object, not null/undefined).
- **horizon-scan.AC2.5 (unknown provider):** `getModel` throws an error when given an invalid provider name. (TypeScript prevents this at compile time, but runtime safety is good.)
- **horizon-scan.AC2.5 (config-driven):** `createLlmClient` accepts an `AppConfig` and returns a model matching the configured provider. Mock the config with different providers and verify `getModel` is called with the right arguments.

Mock the provider constructors at the module level to avoid real API calls. Verify that provider factory functions (`anthropic()`, `openai()`, etc.) are called with the correct model ID.

**Verification:**
Run: `npm test`
Expected: All provider tests pass.

**Commit:** `test: add llm provider factory tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Assessment schema and types

**Files:**
- Create: `src/pipeline/assessment-schema.ts`

Zod schema for the structured LLM output. Used by `generateText()` with `Output.object()` to validate the LLM response at runtime.

**Implementation:**

```typescript
import { z } from "zod";

export const assessmentOutputSchema = z.object({
  relevant: z.boolean().describe("Whether the article is relevant to the topic"),
  summary: z
    .string()
    .describe("2-3 sentence summary of the article's relevance. Empty string if not relevant.")
    .default(""),
  tags: z
    .array(z.string())
    .describe("Entity tags extracted from the article (companies, technologies, people). Empty array if not relevant.")
    .default([]),
});

export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;
```

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add zod schema for llm assessment structured output`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Assessor implementation

**Verifies:** horizon-scan.AC2.1, horizon-scan.AC2.2, horizon-scan.AC2.3, horizon-scan.AC2.4

**Files:**
- Create: `src/pipeline/assessor.ts`

The assessor processes articles with extracted text against all active topics. For each article-topic pair, it calls the LLM via Vercel AI SDK's `generateText()` with `Output.object()` for structured Zod-validated output. Results are stored in the `assessments` table.

**Implementation:**

The AI SDK 6 pattern for structured output uses `generateText()` with the `output` parameter and destructures `experimental_output` from the result:

```typescript
import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
```

Call pattern (pin `ai` to `^6.0.0` in `package.json`):

```typescript
const { experimental_output: result } = await generateText({
  model,
  output: Output.object({ schema: assessmentOutputSchema }),
  system: `You are a relevance assessor. Evaluate whether the article is relevant to the given topic. Return structured JSON.`,
  prompt: `Topic: ${topic.name}\nDescription: ${topic.description}\n\nArticle:\n${articleText}`,
});
```

The `output` parameter is the configuration passed to `generateText()`. The `experimental_output` property on the result object contains the Zod-validated parsed output. The `result` variable is typed as `AssessmentOutput` (inferred from the Zod schema). If the AI SDK version changes this API, the TypeScript compiler will catch it at build time.

Full `assessPendingArticles` function:
- Queries articles with `status: 'pending_assessment'` AND `extractedText` is not null AND `assessmentRetryCount < 3`
- For each article, queries all enabled topics
- Skips article-topic pairs that already have an assessment in the `assessments` table
- Calls `generateText()` with structured output for each pair
- On success: inserts assessment row with `relevant`, `summary`, `tags`, `modelUsed`, `provider`, `assessedAt`
- On failure: increments `assessmentRetryCount` on the article; marks `status: 'failed'` when count reaches 3 (AC2.4)
- After all topics assessed for an article, updates article `status` to `'assessed'`
- Truncates article text to `config.assessment.maxArticleLength` before sending to LLM

Key behaviours:
- Each article assessed against EVERY active topic (AC2.1)
- Relevant articles get summary + tags in the assessment row (AC2.2)
- Output validated by Zod schema (AC2.3)
- LLM errors caught per-article, retry count incremented, max 3 retries before `failed` (AC2.4)
- Model identity recorded (`modelUsed`, `provider`) for audit trail

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add llm article assessor with structured output`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Assessor tests

**Verifies:** horizon-scan.AC2.1, horizon-scan.AC2.2, horizon-scan.AC2.3, horizon-scan.AC2.4

**Files:**
- Test: `src/pipeline/assessor.test.ts` (unit + integration)

**Testing:**

- **horizon-scan.AC2.1 (assess per topic):** Given an article with extracted text and 2 active topics, the assessor calls the LLM for each article-topic pair. Verify by mocking `generateText` and checking it's called twice (once per topic). Use in-memory database with seeded topics.
- **horizon-scan.AC2.2 (relevant with summary + tags):** When the LLM returns `{ relevant: true, summary: "...", tags: ["AI", "Cloud"] }`, the assessment row in the database contains the summary and tags. Query the assessments table to verify.
- **horizon-scan.AC2.3 (structured output):** The `generateText` call includes `output: Output.object({ schema: assessmentOutputSchema })`. Verify the mock receives the correct schema parameter.
- **horizon-scan.AC2.3 (not relevant):** When the LLM returns `{ relevant: false, summary: "", tags: [] }`, the assessment row stores `relevant: false` with empty summary and tags.
- **horizon-scan.AC2.4 (LLM failure retry):** When `generateText` throws (rate limit, timeout), the article's `assessmentRetryCount` is incremented. Verify with direct database query.
- **horizon-scan.AC2.4 (max retries):** When `assessmentRetryCount` reaches 3 after a failure, the article's status is set to `'failed'`. Seed an article with `assessmentRetryCount: 2`, mock LLM to throw, verify status becomes `'failed'`.
- **horizon-scan.AC2.1 (skip already assessed):** Article-topic pairs that already have an assessment row are not re-assessed. Seed an existing assessment, run assessor, verify `generateText` is not called for that pair.
- **horizon-scan.AC2.4 (article text truncation):** When article text exceeds `config.assessment.maxArticleLength`, the prompt sent to the LLM contains truncated text. Verify via mock inspection.

Mock `generateText` from the `ai` module using `vi.mock('ai')`. Use `createTestDatabase()` with seeded feeds, articles (with extractedText), and topics.

**Verification:**
Run: `npm test`
Expected: All assessor tests pass.

**Commit:** `test: add llm assessor unit and integration tests`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
