# Horizon Scan

Last verified: 2026-07-29

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
- `src/db/` - Database connection + Drizzle schema
- `src/embedding/` - Text embedding generation via Ollama
- `src/pipeline/` - RSS polling, dedup, embedding dedup, fetch, extract, LLM assessment
- `src/security/` - URL validation + fetch guard (SSRF prevention)
- `src/concurrency/` - Single-flight lock for poll/digest cycles
- `src/llm/` - Multi-provider LLM client
- `src/digest/` - Email digest: build, render HTML, send via Mailgun
- `src/api/` - tRPC v11 API layer (Express adapter) with auth
- `src/test-utils/` - In-memory SQLite + seed helpers for tests

## Security Model
- **Authentication**: Static API key via `Authorization: Bearer <key>` header. SHA-256 hashed timing-safe comparison.
- **Authorization**: Single-role model — API key grants `role: "admin"` for all operations. Mutations and administrative triggers require `protectedProcedure`. Reads remain `publicProcedure`.
- **Dev mode**: When `API_KEY` env var is unset, all procedures are unauthenticated (with warning log).
- **Bind host**: Defaults to `127.0.0.1` (loopback). Docker overrides via `BIND_HOST=0.0.0.0`.
- **SSRF prevention**: All outbound HTTP requests go through `guardedFetch()` with DNS validation (ipaddr.js), DNS pinning (undici Agent), per-hop redirect validation, and response byte capping.

## Startup Sequence
1. Load + validate YAML config
2. Create SQLite DB, run pre-migration duplicate cleanup, run Drizzle migrations
3. Seed feeds/topics from config (idempotent)
4. Init LLM client (warns + continues if fails)
5. Init embedding model via Ollama
6. Start poll scheduler (single-flight guarded)
7. Start digest scheduler (single-flight guarded)
8. Capture HTTP server from `app.listen()`
9. Register SIGTERM/SIGINT shutdown handlers (with HTTP server + drain)
10. Start Express + tRPC API server

## Shutdown Sequence
1. Set shutdown admission gate (prevents new poll cycles)
2. Stop schedulers (stop admitting new cron work)
3. Close HTTP server (reject new requests)
4. Drain active jobs via `drainScheduler()` with timeout (`drainTimeoutMs`, default 30s)
5. Close SQLite database
6. Exit 0 on success, 1 on timeout/failure

## Conventions
- Functional Core / Imperative Shell pattern
- All domain modules export through barrel `index.ts`
- Dependencies injected as function params
- Errors returned as discriminated unions where feasible
- Readonly types throughout
- Config validated with Zod at startup

## Environment Variables
- `CONFIG_PATH` - Path to config.yaml (default: `./config.yaml`)
- `DATABASE_URL` - SQLite file path (default: `./data/horizon-scan.db`)
- `PORT` - API server port (default: `3000`)
- `API_KEY` - Static API key for auth (unset = dev mode)
- `BIND_HOST` - Server bind host (default: `127.0.0.1`, Docker: `0.0.0.0`)
- `LOG_LEVEL` - pino log level (default: `info`)

## Boundaries
- Safe to edit: `src/`, `config.yaml`, `docker-compose.yml`
- Do not edit: `drizzle/` migrations (immutable, generated), `package-lock.json`
- Schema changes: Edit `src/db/schema.ts` then run `npm run db:generate`

## Testing
- In-memory SQLite for all DB tests
- `src/test-utils/db.ts` provides `createTestDatabase()`, seed helpers, `createTestCaller()`
- Tests co-located with source (`*.test.ts`)
