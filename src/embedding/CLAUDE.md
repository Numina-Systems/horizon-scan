# Embedding

Last verified: 2026-03-11

## Purpose
Generates text embeddings via Ollama for semantic deduplication. Wraps the Vercel AI SDK embedding API.

## Contracts
- **Exposes**: `createEmbeddingModel(baseUrl?) -> EmbeddingModel`, `generateEmbedding(model, text) -> number[]`, `prepareEmbeddingInput(input) -> string`, `cosineSimilarity` (re-export from ai)
- **Guarantees**: Text input truncated to title + first 1000 chars of body. Embedding dimension determined by model (768 for qwen3-embedding:0.6b).
- **Expects**: Ollama running with embedding model pulled. Base URL via param or OLLAMA_BASE_URL env var.

## Dependencies
- **Uses**: `ai` (Vercel AI SDK), `ollama-ai-provider-v2`
- **Used by**: `src/pipeline/dedup.ts`
- **Boundary**: This module generates embeddings; dedup logic lives in pipeline

## Key Files
- `index.ts` - All exports: model factory, embedding generation, text prep, cosine similarity re-export
