# Digest

Last verified: 2026-02-12

## Purpose
Builds, renders, and sends periodic email digests of relevant articles grouped by topic. The digest cycle advances a time window so articles are not re-sent.

## Contracts
- **Exposes**: `buildDigest(db) -> DigestData`, `renderDigestHtml(data) -> string`, `createMailgunSender(key, domain) -> SendDigestFn`, `runDigestCycle(db, config, sendFn, logger)`
- **Guarantees**: Empty digests record a `success` row to advance the time window but do NOT send email. Send failures return error in result (never throw). HTML is XSS-safe (all content escaped).
- **Expects**: DB with assessments table populated. Mailgun credentials for actual sending.

## Dependencies
- **Uses**: `src/db` (assessments, articles, topics, digests tables), `mailgun.js`, `form-data`
- **Used by**: `src/scheduler.ts` (digest cron), `src/api/routers/digests.ts` (read-only history)
- **Boundary**: Sender is injected as `SendDigestFn` for testability; module does not import Mailgun directly in orchestrator

## Key Decisions
- Time window via last digest: `buildDigest` queries assessments since the last successful digest's `sentAt`
- Inline CSS only: Email client compatibility (no `<style>` tags)
- Empty digest records success: Prevents re-sending stale articles on the next cycle

## Invariants
- Digest `sentAt` always advances (even for empty digests)
- `SendDigestFn` never throws; errors returned as `{ success: false, error }`
- All rendered HTML values are escaped via `escapeHtml()`

## Key Files
- `builder.ts` - Queries DB, groups articles by topic
- `renderer.ts` - Pure function: DigestData -> HTML string
- `sender.ts` - Mailgun sender factory
- `orchestrator.ts` - `runDigestCycle()` coordinates build -> render -> send -> record
