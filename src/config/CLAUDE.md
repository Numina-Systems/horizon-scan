# Config

Last verified: 2026-02-12

## Purpose
Loads and validates application configuration from a YAML file at startup. Single source of truth for all runtime settings (feeds, topics, LLM provider, schedules, extraction tuning).

## Contracts
- **Exposes**: `loadConfig(path) -> AppConfig`, `AppConfig` type
- **Guarantees**: Returned config is fully validated via Zod; invalid config throws with descriptive error messages listing each failed field
- **Expects**: Valid file path to a YAML file; crashes the process if config is invalid (by design)

## Dependencies
- **Uses**: `yaml` (parser), `zod` (validation)
- **Used by**: `src/index.ts` (startup), `src/scheduler.ts`, `src/api/`, `src/pipeline/`, `src/digest/`
- **Boundary**: Config is read-only after startup; no runtime mutation

## Key Decisions
- YAML over JSON/env: Human-readable config for feeds and topics with nested structure
- Zod validation at load time: Fail fast with clear errors rather than runtime surprises

## Key Files
- `schema.ts` - Zod schema defining `AppConfig` shape
- `index.ts` - `loadConfig()` function and re-export of `AppConfig` type
