// pattern: Mixed (Functional Core + Imperative Shell)
// Functional Core: prepareEmbeddingInput (pure text manipulation)
// Imperative Shell: generateEmbedding (async/network I/O), createEmbeddingModel (env var reads, factory)

import { embed, cosineSimilarity } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { EmbeddingModel } from "ai";

export type EmbeddingInput = {
  readonly title: string | null;
  readonly body: string | null;
};

/**
 * Prepare text for embedding generation by concatenating title and first 1000 chars of body.
 * Pure function suitable for testing and composition.
 */
export function prepareEmbeddingInput(input: Readonly<EmbeddingInput>): string {
  const title = input.title ?? "";
  const body = (input.body ?? "").slice(0, 1000);
  return `${title}\n${body}`.trim();
}

/**
 * Create an embedding model pointing to the Ollama embedding service.
 * Defaults to OLLAMA_BASE_URL environment variable or localhost.
 */
export function createEmbeddingModel(baseUrl?: string): EmbeddingModel {
  const ollama = createOllama({
    baseURL: baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434",
  });
  return ollama.embeddingModel("qwen3-embedding:0.6b");
}

/**
 * Generate an embedding for the given text using the Vercel AI SDK.
 * Returns a read-only array of numbers representing the embedding vector.
 */
export async function generateEmbedding(
  model: EmbeddingModel,
  text: string,
): Promise<ReadonlyArray<number>> {
  const result = await embed({ model, value: text });
  return result.embedding;
}

export { cosineSimilarity } from "ai";
