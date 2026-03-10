# API

Last verified: 2026-03-09

## Purpose
Provides a tRPC v11 API layer over Express for managing and querying feeds, topics, articles, assessments, and digests. Includes system status endpoint.

## Contracts
- **Exposes**: `createApiServer(context) -> Express`, `appRouter`, `AppRouter` type, `AppContext` type
- **Guarantees**: All procedures receive `{ db, config, logger }` context. Input validated via Zod. API mounted at `/api/trpc`. Health check at `/health`.
- **Expects**: Initialised DB, loaded config, and logger passed as context at server creation.

## tRPC Router Structure
- `feeds` - CRUD (list, getById, create, update, delete)
- `topics` - CRUD (list, getById, create, update, delete)
- `articles` - Read-only (list with filters, getById with assessments)
- `assessments` - Read (list with filters, getByArticle) + reassess mutation (deletes assessments, resets article status)
- `digests` - Read-only (list with pagination)
- `system` - Status query (feed/topic counts, last poll, LLM config)

## Dependencies
- **Uses**: `src/db` (schema + queries), `src/config` (AppConfig type), `@trpc/server`, `express`
- **Used by**: `src/index.ts` (mounts server)
- **Boundary**: API layer is read/write for feeds and topics; assessments has a reassess mutation; articles and digests are read-only

## Key Decisions
- tRPC over REST: Type-safe API with zero codegen, callable from TypeScript clients
- No auth middleware: Internal tool, not public-facing
- Express adapter: Simple HTTP server with `/health` for container probes

## Key Files
- `server.ts` - Express app factory with tRPC middleware
- `router.ts` - Root router composing sub-routers
- `trpc.ts` - tRPC init, exports `router`, `publicProcedure`, `createCallerFactory`
- `context.ts` - `AppContext` type definition
- `routers/` - Individual domain routers
