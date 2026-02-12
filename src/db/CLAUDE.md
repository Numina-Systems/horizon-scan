# Database

Last verified: 2026-02-12

## Purpose
Provides the SQLite database connection and Drizzle ORM schema. All persistent state flows through this module.

## Contracts
- **Exposes**: `createDatabase(path) -> { db, close }`, `AppDatabase` type, table schemas (`feeds`, `articles`, `topics`, `assessments`, `digests`)
- **Guarantees**: WAL mode enabled, foreign keys enforced, parent directory auto-created
- **Expects**: Valid file path (or `:memory:` for tests)

## Dependencies
- **Uses**: `better-sqlite3`, `drizzle-orm`
- **Used by**: Every domain (pipeline, digest, api, scheduler, seed)
- **Boundary**: Schema is the contract; do not query SQLite directly outside Drizzle

## Invariants
- Articles deduplicated by `guid` (unique constraint)
- Article status is one of: `pending_assessment`, `assessed`, `failed`
- Digest status is one of: `success`, `failed`
- All timestamps stored as Unix epochs via Drizzle `mode: "timestamp"`
- Foreign keys: articles -> feeds, assessments -> articles + topics

## Key Decisions
- SQLite over Postgres: Single-binary deployment, no external DB dependency
- WAL mode: Concurrent reads during writes
- JSON columns (`extractor_config`, `metadata`, `tags`): Flexible schema within typed boundaries

## Key Files
- `schema.ts` - All 5 table definitions (feeds, articles, topics, assessments, digests)
- `index.ts` - `createDatabase()` factory and type exports
