# Embedding Dedup Implementation Plan

**Goal:** Add dedup configuration to config.yaml, Zod schema, feeds table, and seed process

**Architecture:** Extend the existing config schema with a top-level `dedup` section for global settings, plus a per-feed `dedupLookbackDays` override. Since per-feed config lives in the DB after seed (not queried from config at runtime), the per-feed override must also be added to the feeds table schema and seed process.

**Tech Stack:** Zod, Drizzle ORM, YAML config

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

### embedding-dedup.AC5: Configuration
- **embedding-dedup.AC5.1 Success:** similarityThreshold validates as 0-1 range at startup
- **embedding-dedup.AC5.2 Success:** lookbackDays validates as positive integer at startup
- **embedding-dedup.AC5.3 Success:** Per-feed dedupLookbackDays overrides global default

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Add dedup section to Zod config schema

**Verifies:** embedding-dedup.AC5.1, embedding-dedup.AC5.2

**Files:**
- Modify: `src/config/schema.ts:9-15` (feedConfigSchema) and `src/config/schema.ts:23-54` (appConfigSchema)

**Implementation:**

1. Add `dedupLookbackDays` to the `feedConfigSchema` (after line 14):

```typescript
dedupLookbackDays: z.number().int().positive().optional(),
```

This is optional per-feed — when absent, the global default applies.

2. Add a `dedup` section to the `appConfigSchema` (after the `assessment` section, before closing):

```typescript
dedup: z
  .object({
    similarityThreshold: z.number().min(0).max(1).default(0.9),
    defaultLookbackDays: z.number().int().positive().default(15),
  })
  .default({}),
```

The `.default({})` pattern matches the existing `extraction` and `assessment` sections — the entire section is optional with sensible defaults.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(config): add dedup config section with similarity threshold and lookback days`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add dedupLookbackDays column to feeds table

**Files:**
- Modify: `src/db/schema.ts:14-27` (feeds table definition)
- Generated: `drizzle/0002_*.sql` (migration for feeds table change)

**Implementation:**

Add `dedupLookbackDays` column to the `feeds` table in `src/db/schema.ts`, after `enabled` (line 22):

```typescript
dedupLookbackDays: integer("dedup_lookback_days"),
```

This is nullable (no `.notNull()`) — null means "use global default". Follows the same pattern as other optional columns.

**Step 1:** Add the column to schema.ts
**Step 2:** Generate migration: `npm run db:generate`
**Step 3:** Verify migration: `npm run db:push`
**Step 4:** Run tests: `npm test` — all existing tests should pass

**Commit:** `feat(db): add dedupLookbackDays column to feeds table`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update seed to persist per-feed dedupLookbackDays

**Files:**
- Modify: `src/seed.ts:33-42` (feed seed loop)

**Implementation:**

In the feed seed loop (`src/seed.ts:33-42`), add `dedupLookbackDays` to the values object:

```typescript
db.insert(feeds)
  .values({
    name: feed.name,
    url: feed.url,
    extractorConfig: feed.extractorConfig,
    pollIntervalMinutes: feed.pollIntervalMinutes,
    enabled: feed.enabled,
    dedupLookbackDays: feed.dedupLookbackDays,
  })
  .run();
```

Since `dedupLookbackDays` is optional in both the Zod schema and the DB column, this will insert `null` when not specified in config — which is the correct "use global default" behaviour.

**Note:** The seed process is idempotent — it skips seeding if feeds already exist (`src/seed.ts:27`). Adding `dedupLookbackDays` to the seed only affects fresh databases. Existing deployments will need to update the feeds table manually or via a migration if per-feed overrides are desired. This is a known limitation of the seed pattern (documented in MEMORY.md).

**Verification:**
Run: `npm test`
Expected: All tests pass. Existing seed tests should work since the new field is optional.

**Commit:** `feat(seed): persist per-feed dedupLookbackDays from config`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update createTestConfig() with dedup defaults

**Files:**
- Modify: `src/test-utils/db.ts:136-176` (createTestConfig function)

**Implementation:**

Add the `dedup` section to the `createTestConfig()` return value, after the `assessment` section:

```typescript
dedup: {
  similarityThreshold: 0.9,
  defaultLookbackDays: 15,
},
```

This ensures ALL existing and future tests get the `dedup` field without needing manual spreads. Without this, any code accessing `config.dedup.similarityThreshold` would throw because `createTestConfig()` returns a raw object that doesn't go through Zod parsing (where defaults would be applied).

**Verification:**
Run: `npm test`
Expected: All existing tests pass

**Commit:** `test(utils): add dedup defaults to createTestConfig`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Config validation tests

**Verifies:** embedding-dedup.AC5.1, embedding-dedup.AC5.2, embedding-dedup.AC5.3

**Files:**
- Create or modify: `src/config/schema.test.ts` (check if exists; create if not)

**Testing:**

Tests must verify:
- **embedding-dedup.AC5.1:** `similarityThreshold` validates as 0-1 range
  - Valid: 0, 0.5, 0.9, 1 all parse without error
  - Invalid: -0.1 and 1.1 fail Zod validation
  - Default: omitting `dedup` section entirely → `similarityThreshold` defaults to 0.9

- **embedding-dedup.AC5.2:** `lookbackDays` validates as positive integer
  - Valid: 1, 15, 30 all parse without error
  - Invalid: 0, -1, 1.5 fail Zod validation
  - Default: omitting `dedup` section entirely → `defaultLookbackDays` defaults to 15

- **embedding-dedup.AC5.3:** Per-feed `dedupLookbackDays` overrides global default
  - Feed with `dedupLookbackDays: 7` parses correctly
  - Feed without `dedupLookbackDays` → field is undefined (will use global default at runtime)

Use `appConfigSchema.parse()` / `appConfigSchema.safeParse()` directly for validation tests. Build a minimal valid config object to test against (use `createTestConfig()` from test-utils if it returns the right shape, otherwise construct manually).

Follow project test patterns: `describe` / `it` blocks with Vitest globals.

**Verification:**
Run: `npm test`
Expected: All tests pass

**Commit:** `test(config): add validation tests for dedup config`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_6 -->
### Task 6: Update config.yaml with dedup section

**Files:**
- Modify: `config.yaml` (add dedup section)

**Implementation:**

Add a `dedup` section to `config.yaml` after the `assessment` section:

```yaml
dedup:
  similarityThreshold: 0.90
  defaultLookbackDays: 15
```

No per-feed `dedupLookbackDays` overrides needed in the default config — the global default applies to all feeds unless explicitly overridden.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors. Config validation tests from Task 5 cover the runtime validation.

**Commit:** `chore(config): add dedup section to config.yaml`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Update config CLAUDE.md

**Files:**
- Modify: `src/config/CLAUDE.md`

**Implementation:**

Update the Contracts section to mention `dedup` configuration. Add to the existing bullet points:

In the **Exposes** line, the `AppConfig` type now includes `dedup.similarityThreshold`, `dedup.defaultLookbackDays`, and per-feed `dedupLookbackDays`.

**Commit:** `docs(config): update CLAUDE.md with dedup config documentation`
<!-- END_TASK_7 -->
