# Horizon Scan Implementation Plan — Phase 6: tRPC API Layer

**Goal:** Expose feeds, topics, articles, assessments, digests, and system health via typed tRPC endpoints over Express. Support CRUD for feeds and topics.

**Architecture:** Express server hosts tRPC via the Express adapter at `/api/trpc`. Router is split into sub-routers per domain (feeds, topics, articles, assessments, digests, system). Context provides the database instance and logger.

**Tech Stack:** @trpc/server v11, express 5.x, @types/express, Zod 3.x (input validation)

**Scope:** 8 phases from original design (phases 1-8). This is phase 6.

**Codebase verified:** 2026-02-12 — Greenfield project. All database tables exist from Phase 1. Assessments populated by Phase 4. Config system provides all needed settings.

**Design deviations:**
- **AC5.3 `nextDigestTime` → `digestCron`:** Design specifies "next digest time" in system status. node-cron v4 does not expose next execution time programmatically. Rather than adding a dependency (cron-parser) solely for this, the endpoint returns `digestCron` — the raw cron expression string from config. Clients can parse it if they need the next execution timestamp.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC5: API layer
- **horizon-scan.AC5.1 Success:** tRPC endpoints for feeds, topics, articles, assessments, digests return correct data with proper typing
- **horizon-scan.AC5.2 Success:** Feed and topic CRUD operations modify the database and are reflected in subsequent queries
- **horizon-scan.AC5.3 Success:** `system.status` endpoint returns health info including last poll time, digest cron schedule, and configured provider

---

<!-- START_TASK_1 -->
### Task 1: Add tRPC and Express dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run: `npm install @trpc/server express`
Run: `npm install --save-dev @types/express`

This adds:
- `@trpc/server` v11 — tRPC server with Express adapter built-in
- `express` 5.x — HTTP server
- `@types/express` — TypeScript definitions

> **Note:** tRPC v11 supports nested routers via plain objects. The Express adapter is at `@trpc/server/adapters/express`.

**Step 2: Verify**

Run: `npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add trpc server and express dependencies"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: tRPC initialisation and context

**Files:**
- Create: `src/api/trpc.ts`
- Create: `src/api/context.ts`

Set up tRPC with typed context that provides database and logger to all procedures.

**Implementation:**

`src/api/context.ts`:

```typescript
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import type { Logger } from "pino";

export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
};
```

`src/api/trpc.ts`:

```typescript
import { initTRPC } from "@trpc/server";
import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
```

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add trpc initialisation and typed context`
<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Domain routers implementation

**Verifies:** horizon-scan.AC5.1, horizon-scan.AC5.2, horizon-scan.AC5.3

**Files:**
- Create: `src/api/routers/feeds.ts`
- Create: `src/api/routers/topics.ts`
- Create: `src/api/routers/articles.ts`
- Create: `src/api/routers/assessments.ts`
- Create: `src/api/routers/digests.ts`
- Create: `src/api/routers/system.ts`
- Create: `src/api/router.ts` (root router combining all sub-routers)

Each router file defines tRPC procedures for its domain. Uses Zod for input validation on mutations and parameterised queries.

**Implementation guidance per router:**

**feeds.ts** — CRUD:
- `list` query: returns all feeds
- `getById` query: input `z.object({ id: z.number() })`, returns single feed or null
- `create` mutation: input with name, url, extractorConfig, optional pollIntervalMinutes/enabled
- `update` mutation: input with id + partial fields
- `delete` mutation: input with id, deletes feed row

**topics.ts** — CRUD:
- `list` query: returns all topics
- `getById` query: input id
- `create` mutation: input with name, description, optional enabled
- `update` mutation: input with id + partial fields
- `delete` mutation: input with id

**articles.ts** — Read-only with filters:
- `list` query: input with optional `feedId`, `status`, `limit` (default 50), `offset` (default 0)
- `getById` query: input id, returns article with assessments

**assessments.ts** — Read-only:
- `list` query: input with optional `articleId`, `topicId`, `relevant` filter
- `getByArticle` query: input articleId, returns all assessments for that article

**digests.ts** — Read-only:
- `list` query: returns digest history ordered by sentAt desc, with limit/offset

**system.ts** — Status:
- `status` query: returns `{ lastPollTime, digestCron, provider, model, feedCount, topicCount }`. `lastPollTime` from max `feeds.lastPolledAt`. `digestCron` is the raw cron expression string from `config.schedule.digest` (node-cron v4 does not expose next execution time; clients can parse the cron expression if needed). Provider and model from config.

**Root router** (`src/api/router.ts`):

```typescript
import { router } from "./trpc";
import { feedsRouter } from "./routers/feeds";
import { topicsRouter } from "./routers/topics";
import { articlesRouter } from "./routers/articles";
import { assessmentsRouter } from "./routers/assessments";
import { digestsRouter } from "./routers/digests";
import { systemRouter } from "./routers/system";

export const appRouter = router({
  feeds: feedsRouter,
  topics: topicsRouter,
  articles: articlesRouter,
  assessments: assessmentsRouter,
  digests: digestsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
```

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add trpc domain routers for all entities`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Domain router tests

**Verifies:** horizon-scan.AC5.1, horizon-scan.AC5.2, horizon-scan.AC5.3

**Files:**
- Test: `src/api/routers/feeds.test.ts` (integration)
- Test: `src/api/routers/topics.test.ts` (integration)
- Test: `src/api/routers/articles.test.ts` (integration)
- Test: `src/api/routers/system.test.ts` (integration)

**Testing:**
Use tRPC's `createCallerFactory` to call routers directly without HTTP. Each test creates an in-memory database, seeds test data, and calls procedures via the caller.

```typescript
import { createCallerFactory } from "@trpc/server";
import { appRouter } from "../router";

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db, config, logger });
```

- **horizon-scan.AC5.1 (feeds list):** Seed 2 feeds. Call `caller.feeds.list()`. Verify returns array of 2 feeds with correct fields.
- **horizon-scan.AC5.2 (feed CRUD):** Call `caller.feeds.create(...)`, then `caller.feeds.list()` to verify the new feed appears. Call `caller.feeds.update(...)` then `caller.feeds.getById(...)` to verify update. Call `caller.feeds.delete(...)` then verify list no longer includes it.
- **horizon-scan.AC5.2 (topic CRUD):** Same pattern as feed CRUD — create, read, update, delete with verification.
- **horizon-scan.AC5.1 (articles with filters):** Seed articles with different statuses and feed IDs. Call `caller.articles.list({ feedId: X })` and verify only matching articles returned. Test `status` filter and `limit`/`offset` pagination.
- **horizon-scan.AC5.1 (assessments):** Seed assessments. Call `caller.assessments.list({ relevant: true })` and verify only relevant assessments returned.
- **horizon-scan.AC5.3 (system status):** Seed feeds with `lastPolledAt` set. Call `caller.system.status()`. Verify response includes `lastPollTime`, `digestCron` (cron expression string from config), `provider`, `model`, `feedCount`, `topicCount`.

**Verification:**
Run: `npm test`
Expected: All router tests pass.

**Commit:** `test: add trpc router integration tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: Express server setup

**Files:**
- Create: `src/api/server.ts`

Wire tRPC router into Express via the adapter.

**Implementation:**

```typescript
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Logger } from "pino";
import { appRouter } from "./router";
import type { AppContext } from "./context";

export function createApiServer(context: AppContext): express.Express {
  const app = express();

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => context,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
```

Key behaviours:
- tRPC mounted at `/api/trpc` path
- Context factory provides same db/config/logger to all procedures
- Simple `/health` endpoint for container health checks
- Returns Express app instance (not started) — caller decides port

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add express server with trpc middleware`
<!-- END_TASK_5 -->
