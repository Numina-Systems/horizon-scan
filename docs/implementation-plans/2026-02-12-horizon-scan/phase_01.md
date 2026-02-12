# Horizon Scan Implementation Plan — Phase 1: Project Scaffolding & Database

**Goal:** Initialise TypeScript project, configure tooling, set up SQLite database with Drizzle ORM schema and migrations, create configuration system with Zod validation.

**Architecture:** Pipeline-based RSS monitoring service using SQLite (via Drizzle ORM + better-sqlite3) as the data layer. Config loaded from YAML file with Zod schema validation. Structured JSON logging via pino.

**Tech Stack:** TypeScript 5.7+, Drizzle ORM 0.45+, better-sqlite3, drizzle-kit, Zod 3.x, pino 10.x, yaml 2.x

**Scope:** 8 phases from original design (phases 1-8). This is phase 1.

**Codebase verified:** 2026-02-12 — Greenfield project, no existing files beyond design doc and empty readme.

> **Note:** Test infrastructure (vitest, test utilities, in-memory database helpers) is set up in Phase 2. This phase is verified operationally only.

---

## Acceptance Criteria Coverage

**Verifies: None** — This is an infrastructure setup phase. Verification is operational (install succeeds, build succeeds, migrations run, config loads and validates).

---

<!-- START_TASK_1 -->
### Task 1: Project initialisation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "horizon-scan",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.45.0",
    "pino": "^10.0.0",
    "yaml": "^2.8.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

> **Note on Zod version:** Pinned to `^3.23.0` (Zod 3.x) for compatibility with Vercel AI SDK's `generateObject()` in Phase 4. Zod 4.x is available but AI SDK compatibility should be verified before upgrading.

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
*.db-wal
data/
.env
```

**Step 4: Install dependencies**

Run: `npm install`
Expected: Installs without errors. `node_modules/` created.

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: initialise project with typescript and dependencies"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Database schema

**Files:**
- Create: `src/db/schema.ts`

This file defines all five database tables using Drizzle ORM's SQLite schema builders. JSON columns use `text({ mode: 'json' })` with `$type<>()` for TypeScript type safety. Booleans use `integer({ mode: 'boolean' })` (SQLite stores as 0/1). Timestamps use `integer({ mode: 'timestamp' })` (Unix seconds).

**Step 1: Create src/db/schema.ts**

```typescript
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------- JSON column types ----------

export type ExtractorConfig = {
  readonly bodySelector: string;
  readonly jsonLd: boolean;
  readonly metadataSelectors?: Readonly<Record<string, string>>;
};

// ---------- Tables ----------

export const feeds = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  extractorConfig: text("extractor_config", { mode: "json" })
    .$type<ExtractorConfig>()
    .notNull(),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(15),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastPolledAt: integer("last_polled_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    guid: text("guid").notNull().unique(),
    title: text("title"),
    url: text("url").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    rawHtml: text("raw_html"),
    extractedText: text("extracted_text"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", {
      enum: ["pending_assessment", "assessed", "failed"],
    })
      .notNull()
      .default("pending_assessment"),
    fetchRetryCount: integer("fetch_retry_count").notNull().default(0),
    assessmentRetryCount: integer("assessment_retry_count").notNull().default(0),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    feedIdIdx: index("articles_feed_id_idx").on(table.feedId),
    statusIdx: index("articles_status_idx").on(table.status),
  }),
);

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const assessments = sqliteTable(
  "assessments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id),
    relevant: integer("relevant", { mode: "boolean" }).notNull(),
    summary: text("summary"),
    tags: text("tags", { mode: "json" }).$type<Array<string>>().notNull(),
    modelUsed: text("model_used").notNull(),
    provider: text("provider").notNull(),
    assessedAt: integer("assessed_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    articleIdIdx: index("assessments_article_id_idx").on(table.articleId),
    topicIdIdx: index("assessments_topic_id_idx").on(table.topicId),
  }),
);

export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
  articleCount: integer("article_count").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["success", "failed"] }).notNull(),
});
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Compiles without errors. `dist/db/schema.js` is generated.

**Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add drizzle orm schema for all five tables"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Database connection and migration config

**Files:**
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

**Step 1: Create src/db/index.ts**

The connection module creates the SQLite database, enables WAL mode for better concurrency, and enables foreign key enforcement. It also ensures the data directory exists.

```typescript
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDatabase(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof createDatabase>;
```

**Step 2: Create drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/horizon-scan.db",
  },
});
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add src/db/index.ts drizzle.config.ts
git commit -m "feat: add database connection and drizzle migration config"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Configuration system

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/index.ts`
- Create: `config.yaml`
- Create: `.env.example`

**Step 1: Create src/config/schema.ts**

Zod schema that validates the entire config.yaml structure. Provides type inference via `z.infer`. Optional fields have sensible defaults matching the design spec.

```typescript
import { z } from "zod";

const extractorConfigSchema = z.object({
  bodySelector: z.string(),
  jsonLd: z.boolean(),
  metadataSelectors: z.record(z.string(), z.string()).optional(),
});

const feedConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  extractorConfig: extractorConfigSchema,
  pollIntervalMinutes: z.number().int().positive().default(15),
  enabled: z.boolean().default(true),
});

const topicConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  llm: z.object({
    provider: z.enum([
      "anthropic",
      "openai",
      "gemini",
      "ollama",
      "lmstudio",
      "zai",
    ]),
    model: z.string().min(1),
  }),
  feeds: z.array(feedConfigSchema).min(1),
  topics: z.array(topicConfigSchema).min(1),
  schedule: z.object({
    poll: z.string().min(1),
    digest: z.string().min(1),
  }),
  digest: z.object({
    recipient: z.string().email(),
  }),
  extraction: z
    .object({
      maxConcurrency: z.number().int().positive().default(2),
      perDomainDelayMs: z.number().int().nonnegative().default(1000),
    })
    .default({}),
  assessment: z
    .object({
      maxArticleLength: z.number().int().positive().default(4000),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
```

**Step 2: Create src/config/index.ts**

Loads the YAML config file, parses it, and validates against the Zod schema. Fails fast with a clear error on invalid config.

```typescript
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { appConfigSchema } from "./schema";
import type { AppConfig } from "./schema";

export function loadConfig(configPath: string): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read config file at ${configPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse YAML in ${configPath}: ${message}`);
  }

  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid configuration in ${configPath}:\n${issues}`);
  }

  return result.data;
}

export type { AppConfig };
```

**Step 3: Create config.yaml**

```yaml
llm:
  provider: ollama
  model: llama3.2

feeds:
  - name: PRNewswire - Technology
    url: https://www.prnewswire.com/rss/technology-latest-news.rss
    extractorConfig:
      bodySelector: "p.prnews_p"
      jsonLd: true

topics:
  - name: AI and Machine Learning
    description: >-
      Articles about artificial intelligence, machine learning, deep learning,
      neural networks, large language models, and AI applications in industry.
  - name: Cloud Computing
    description: >-
      Articles about cloud infrastructure, cloud services (AWS, Azure, GCP),
      serverless computing, and cloud-native technologies.

schedule:
  poll: "*/15 * * * *"
  digest: "0 8 * * 1-5"

digest:
  recipient: user@example.com

extraction:
  maxConcurrency: 2
  perDomainDelayMs: 1000

assessment:
  maxArticleLength: 4000
```

**Step 4: Create .env.example**

```bash
# LLM Provider API Keys (only the one matching config.yaml provider is required)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ZAI_API_KEY=

# Local LLM Base URLs
OLLAMA_BASE_URL=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234

# Email (Mailgun)
MAILGUN_API_KEY=
MAILGUN_DOMAIN=

# Database
DATABASE_URL=./data/horizon-scan.db
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add src/config/schema.ts src/config/index.ts config.yaml .env.example
git commit -m "feat: add config system with zod validation and yaml loading"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Generate and apply database migrations

**Step 1: Create data directory**

Run: `mkdir -p data`

**Step 2: Generate initial migration**

Run: `npm run db:generate`
Expected: Migration SQL file generated in `drizzle/` directory. Output shows tables: feeds, articles, topics, assessments, digests.

**Step 3: Apply migration**

Run: `npm run db:migrate`
Expected: Migration applied successfully. Database file `data/horizon-scan.db` created with all five tables.

**Step 4: Verify tables exist**

Run: `npx tsx -e "const Database = require('better-sqlite3'); const db = new Database('./data/horizon-scan.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all());"`
Expected: Output includes feeds, articles, topics, assessments, digests tables.

**Step 5: Commit**

```bash
git add drizzle/
git commit -m "chore: generate initial database migration"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Verify full Phase 1

Run all verification steps in sequence to confirm everything works end-to-end:

**Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: Build succeeds with no errors.

**Step 2: Verify config loading**

Run: `npx tsx -e "const { loadConfig } = require('./src/config'); const cfg = loadConfig('./config.yaml'); console.log('Provider:', cfg.llm.provider); console.log('Feeds:', cfg.feeds.length); console.log('Topics:', cfg.topics.length);"`
Expected: Outputs `Provider: ollama`, `Feeds: 1`, `Topics: 2`

**Step 3: Verify invalid config fails**

Run: `npx tsx -e "const { loadConfig } = require('./src/config'); try { loadConfig('/dev/null'); } catch(e) { console.log('Validation failed as expected:', e.message.split('\\n')[0]); }"`
Expected: Outputs error message about invalid configuration.

**Step 4: Final commit (if any changes)**

If any fixes were needed during verification, commit them now.
<!-- END_TASK_6 -->
