# API

Last verified: 2026-07-29

## Purpose
Provides a tRPC v11 API layer over Express for managing and querying feeds, topics, articles, assessments, and digests. Includes system status and poll trigger endpoints.

## Auth Model
- **protectedProcedure**: Mutations (feeds/topics CRUD, assessments.reassess, system.triggerPoll). Requires valid `Authorization: Bearer <API_KEY>` header.
- **publicProcedure**: Reads (list, getById, status). No auth required.
- **Dev mode**: When no `API_KEY` is configured, `enforceAuth` middleware injects `principal: { id: "anonymous", role: "admin" }` — all procedures work without auth.
- **Principal**: `{ id: string; role: "admin" }`. Must ONLY be set by `resolvePrincipal()` in server.ts.

## Contracts
- **Exposes**: `createApiServer(context, authKey?) -> Express`, `appRouter`, `protectedProcedure`, `publicProcedure`
- **Guarantees**: All procedures receive `{ db, config, logger, authKey?, principal? }`. Input validated via Zod. API mounted at `/api/trpc`. Health check at `/health` (unauthenticated).

## Key Files
- `server.ts` - Express factory, `resolvePrincipal` (SHA-256 key validation), `resolveBindHost`, WWW-Authenticate interceptor
- `trpc.ts` - tRPC init, `enforceAuth` middleware, `protectedProcedure`
- `context.ts` - `AppContext` type with `authKey?` and `principal?`
- `routers/` - Domain routers (feeds, topics, articles, assessments, digests, system)

## Test Caller Auth
`createTestCaller(db, configOverrides?, authOptions?: { authKey?, principal? })` — third parameter controls auth context for testing.
