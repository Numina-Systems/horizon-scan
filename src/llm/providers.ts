import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

const ollama = createOllama({
  baseURL: process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434",
});

const lmstudio = createOpenAICompatible({
  name: "lmstudio",
  baseURL: process.env["LMSTUDIO_BASE_URL"] ?? "http://localhost:1234/v1",
});

type ProviderName = "anthropic" | "openai" | "gemini" | "ollama" | "lmstudio";

export function getModel(provider: ProviderName, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "openai":
      return openai(modelId);
    case "gemini":
      return google(modelId);
    case "ollama":
      return ollama(modelId);
    case "lmstudio":
      return lmstudio(modelId);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
