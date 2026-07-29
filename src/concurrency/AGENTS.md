# Concurrency

Last verified: 2026-07-29

## Purpose
Single-flight lock mechanism to prevent concurrent poll and digest cycle execution.

## Contracts
- **Exposes**: `createSingleFlight()` returning `{ tryAcquire(): boolean, release(): void, isActive(): boolean }`
- **Guarantees**: Synchronous boolean acquire — no async lock races. `tryAcquire()` returns immediately (true or false). `release()` is a no-op if not held.
- **Used by**: `src/scheduler.ts` (private `pollFlight`/`digestFlight` singletons)

## Design
- Two module-level private singletons in `scheduler.ts`: `pollFlight` and `digestFlight`.
- Both the cron callback and the API `triggerPollCycle` share the same singleton lock.
- `withPollLock`/`withDigestLock` are private wrapper functions with `try/finally` to guarantee lock release.
- `triggerPollCycle` is the sole exported entry point for poll cycles. `runPollCycle` is private.
- Test isolation: `vi.resetModules()` in `beforeEach` creates fresh singletons.
- No `resetSingleFlight`, no lock parameter, no escape hatch in production code.
