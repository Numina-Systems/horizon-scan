# Horizon Scan

Last verified: 2026-02-12

## Tech Stack
- Language: TypeScript 5.x (ES2022 target, CommonJS modules)
- Runtime: Node.js 22
- Database: SQLite via better-sqlite3 + Drizzle ORM
- LLM: Vercel AI SDK (multi-provider: Anthropic, OpenAI, Gemini, Ollama, LM Studio)
- API: tRPC v11 on Express 5
- Email: Mailgun
- Scheduling: node-cron
- Logging: pino (structured JSON to stdout)
- Testing: Vitest
- Container: Docker (multi-stage, node:22-alpine)

## Commands
- `npm test` - Run all tests
- `npm run dev` - Start with tsx watch
- `npm run build` - Compile TypeScript
- `npm start` - Run compiled output
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:push` - Push schema to database

## Project Structure
- `src/config/` - YAML config loading + Zod validation
- `src/db/` - Database connection + Drizzle schema (5 tables)
- `src/pipeline/` - RSS polling, dedup, fetch, extract, LLM assessment
- `src/llm/` - Multi-provider LLM client (Vercel AI SDK)
- `src/digest/` - Email digest: build, render HTML, send via Mailgun
- `src/api/` - tRPC v11 API layer (Express adapter)
- `src/test-utils/` - In-memory SQLite + seed helpers for tests

## Conventions
- Functional Core / Imperative Shell pattern (annotated in file comments)
- All domain modules export through barrel `index.ts`
- Dependencies injected as function params (no DI container)
- Errors returned as discriminated unions, not thrown (where feasible)
- Readonly types throughout (`ReadonlyArray`, `Readonly<>`)
- Config validated with Zod at startup; crashes on invalid config

## Environment Variables
- `CONFIG_PATH` - Path to config.yaml (default: `./config.yaml`)
- `DATABASE_URL` - SQLite file path (default: `./data/horizon-scan.db`)
- `PORT` - API server port (default: `3000`)
- `LOG_LEVEL` - pino log level (default: `info`)
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` - LLM provider keys
- `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL` - Local LLM endpoints
- `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` - Email delivery (optional; digest disabled without)

## Startup Sequence
1. Load + validate YAML config
2. Create SQLite DB, run Drizzle migrations
3. Seed feeds/topics from config (idempotent -- skips if data exists)
4. Init LLM client (warns + continues if fails)
5. Start poll scheduler (cron: poll -> dedup -> fetch -> extract -> assess)
6. Start digest scheduler (cron: build -> render -> send) if Mailgun configured
7. Register SIGTERM/SIGINT shutdown handlers
8. Start Express + tRPC API server

## Boundaries
- Safe to edit: `src/`, `config.yaml`, `docker-compose.yml`
- Do not edit: `drizzle/` migrations (immutable, generated), `package-lock.json`
- Schema changes: Edit `src/db/schema.ts` then run `npm run db:generate`

## Testing
- In-memory SQLite for all DB tests (no file I/O)
- `src/test-utils/db.ts` provides `createTestDatabase()`, seed helpers, and `createTestCaller()` for tRPC
- Tests co-located with source (`*.test.ts`)
