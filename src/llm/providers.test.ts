import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig } from "../config";

const mockModel = { id: "mock-model" };

vi.mock("@ai-sdk/anthropic", () => {
  const mockFn = vi.fn(() => mockModel);
  return {
    anthropic: mockFn,
  };
});

vi.mock("@ai-sdk/openai", () => {
  const mockFn = vi.fn(() => mockModel);
  return {
    openai: mockFn,
  };
});

vi.mock("@ai-sdk/google", () => {
  const mockFn = vi.fn(() => mockModel);
  return {
    google: mockFn,
  };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => () => mockModel),
}));

vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: vi.fn(() => () => mockModel),
}));

// Import after mocking
import { getModel } from "./providers";
import { createLlmClient } from "./client";

const createMinimalConfig = (
  provider: AppConfig["llm"]["provider"],
  model: string,
): AppConfig => ({
  llm: {
    provider,
    model,
  },
  feeds: [
    {
      name: "Test Feed",
      url: "https://example.com/feed",
      extractorConfig: {
        bodySelector: "body",
        jsonLd: false,
      },
      pollIntervalMinutes: 15,
      enabled: true,
    },
  ],
  topics: [
    {
      name: "Test Topic",
      description: "Test description",
      enabled: true,
    },
  ],
  schedule: {
    poll: "0 */6 * * *",
    digest: "0 9 * * *",
  },
  digest: {
    recipient: "test@example.com",
  },
  extraction: {
    maxConcurrency: 2,
    perDomainDelayMs: 1000,
  },
  assessment: {
    maxArticleLength: 4000,
  },
});

describe("getModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a LanguageModel for anthropic provider", () => {
    const model = getModel("anthropic", "claude-3-5-sonnet");

    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
  });

  it("should return a LanguageModel for openai provider", () => {
    const model = getModel("openai", "gpt-4");

    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
  });

  it("should return a LanguageModel for gemini provider", () => {
    const model = getModel("gemini", "gemini-2.0-flash");

    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
  });

  it("should return a LanguageModel for ollama provider", () => {
    const model = getModel("ollama", "llama2");

    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
  });

  it("should return a LanguageModel for lmstudio provider", () => {
    const model = getModel("lmstudio", "local-model");

    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
  });

  it("should throw an error when given an unknown provider", () => {
    const unknownProvider = "invalid-provider" as any;

    expect(() => {
      getModel(unknownProvider, "some-model");
    }).toThrow();
  });

  it("should pass the correct model ID to each provider", async () => {
    const { anthropic } = await import("@ai-sdk/anthropic");
    const { openai } = await import("@ai-sdk/openai");
    const { google } = await import("@ai-sdk/google");

    getModel("anthropic", "test-model-123");
    getModel("openai", "gpt-4-turbo");
    getModel("gemini", "gemini-test");

    expect(anthropic).toHaveBeenCalledWith("test-model-123");
    expect(openai).toHaveBeenCalledWith("gpt-4-turbo");
    expect(google).toHaveBeenCalledWith("gemini-test");
  });
});

describe("createLlmClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a client with anthropic provider from config", () => {
    const config = createMinimalConfig("anthropic", "claude-3-5-sonnet");

    const model = createLlmClient(config);

    expect(model).toBeDefined();
  });

  it("should create a client with openai provider from config", () => {
    const config = createMinimalConfig("openai", "gpt-4");

    const model = createLlmClient(config);

    expect(model).toBeDefined();
  });

  it("should create a client with ollama provider from config", () => {
    const config = createMinimalConfig("ollama", "llama2");

    const model = createLlmClient(config);

    expect(model).toBeDefined();
  });

  it("should create a client with lmstudio provider from config", () => {
    const config = createMinimalConfig("lmstudio", "local-model");

    const model = createLlmClient(config);

    expect(model).toBeDefined();
  });

  it("should create a client with gemini provider from config", () => {
    const config = createMinimalConfig("gemini", "gemini-2.0-flash");

    const model = createLlmClient(config);

    expect(model).toBeDefined();
  });

  it("should use the model ID from config", async () => {
    const { anthropic } = await import("@ai-sdk/anthropic");

    const config = createMinimalConfig("anthropic", "claude-3-5-sonnet-custom");

    createLlmClient(config);

    expect(anthropic).toHaveBeenCalledWith("claude-3-5-sonnet-custom");
  });
});
