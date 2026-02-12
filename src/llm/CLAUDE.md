# LLM

Last verified: 2026-02-12

## Purpose
Abstracts LLM provider selection behind the Vercel AI SDK. Maps config provider names to concrete SDK instances.

## Contracts
- **Exposes**: `getModel(provider, modelId) -> LanguageModel`, `createLlmClient(config) -> LanguageModel`, `ProviderName` type
- **Guarantees**: Exhaustive switch on provider name (compile-time `never` check). Unknown provider throws at runtime.
- **Expects**: Appropriate API key env var set for the chosen provider. Local providers (Ollama/LM Studio) need running server.

## Dependencies
- **Uses**: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `ollama-ai-provider-v2`
- **Used by**: `src/index.ts` (startup), `src/pipeline/assessor.ts` (via injected model)
- **Boundary**: This module only creates model instances; it does not call them

## Key Decisions
- Vercel AI SDK: Unified interface across providers, structured output support
- Provider as config value: Switchable without code changes
- Ollama + LM Studio: Local-first development without API keys

## Key Files
- `providers.ts` - `getModel()` with exhaustive provider switch
- `client.ts` - `createLlmClient()` convenience wrapper
