import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmbedding = Array(768).fill(0.1);

vi.mock("ai", () => ({
  embed: vi.fn(async ({ model, value }: { model: unknown; value: string }) => ({
    embedding: mockEmbedding,
  })),
  cosineSimilarity: vi.fn((a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
    // Mock implementation of cosine similarity
    return 0.95;
  }),
}));

vi.mock("ollama-ai-provider-v2", () => {
  const mockEmbeddingModel = { id: "qwen3-embedding:0.6b" };
  return {
    createOllama: vi.fn(() => ({
      embeddingModel: vi.fn(() => mockEmbeddingModel),
    })),
  };
});

// Import after mocking
import {
  prepareEmbeddingInput,
  generateEmbedding,
  createEmbeddingModel,
  cosineSimilarity,
} from "./index";
import { embed } from "ai";
import { createOllama } from "ollama-ai-provider-v2";

describe("prepareEmbeddingInput", () => {
  it("should return title when body is null", () => {
    const input = { title: "Test Title", body: null };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe("Test Title");
  });

  it("should return body when title is null", () => {
    const input = { title: null, body: "Test body content" };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe("Test body content");
  });

  it("should return concatenated title and body with newline", () => {
    const input = { title: "Test Title", body: "Test body content" };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe("Test Title\nTest body content");
  });

  it("should return empty string when both title and body are null", () => {
    const input = { title: null, body: null };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe("");
  });

  it("should not truncate body when exactly 1000 chars", () => {
    const body1000 = "a".repeat(1000);
    const input = { title: "Title", body: body1000 };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe(`Title\n${body1000}`);
  });

  it("should truncate body to 1000 chars when longer", () => {
    const bodyOver1000 = "a".repeat(2000);
    const input = { title: "Title", body: bodyOver1000 };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe(`Title\n${"a".repeat(1000)}`);
  });

  it("should trim whitespace from concatenated result", () => {
    const input = { title: null, body: "  " };
    const result = prepareEmbeddingInput(input);
    expect(result).toBe("");
  });
});

describe("generateEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call embed with model and text value", async () => {
    const mockModel = "test-model";
    const text = "test text";

    await generateEmbedding(mockModel, text);

    expect(embed).toHaveBeenCalledWith({
      model: mockModel,
      value: text,
    });
  });

  it("should return embedding array from SDK result", async () => {
    const mockModel = "test-model";
    const result = await generateEmbedding(mockModel, "test");

    expect(result).toEqual(mockEmbedding);
    expect(result.length).toBe(768);
  });

  it("should return array of numbers", async () => {
    const mockModel = "test-model";
    const result = await generateEmbedding(mockModel, "test");

    expect(Array.isArray(result)).toBe(true);
    expect(result.every((item) => typeof item === "number")).toBe(true);
  });
});

describe("createEmbeddingModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return an embedding model without throwing", () => {
    const model = createEmbeddingModel();
    expect(model).toBeDefined();
    expect(typeof model).toBe("object");
  });

  it("should use provided baseUrl when specified", () => {
    const customUrl = "http://custom:11434";
    createEmbeddingModel(customUrl);

    expect(createOllama).toHaveBeenCalledWith({
      baseURL: customUrl,
    });
  });

  it("should use OLLAMA_BASE_URL environment variable when baseUrl not provided", () => {
    const originalEnv = process.env["OLLAMA_BASE_URL"];
    process.env["OLLAMA_BASE_URL"] = "http://from-env:11434";

    createEmbeddingModel();

    expect(createOllama).toHaveBeenCalledWith({
      baseURL: "http://from-env:11434",
    });

    process.env["OLLAMA_BASE_URL"] = originalEnv;
  });

  it("should default to localhost:11434 when no baseUrl or env var", () => {
    const originalEnv = process.env["OLLAMA_BASE_URL"];
    delete process.env["OLLAMA_BASE_URL"];

    createEmbeddingModel();

    expect(createOllama).toHaveBeenCalledWith({
      baseURL: "http://localhost:11434",
    });

    if (originalEnv) {
      process.env["OLLAMA_BASE_URL"] = originalEnv;
    }
  });

  it("should call embeddingModel with qwen3-embedding:0.6b", () => {
    createEmbeddingModel();

    const ollamaInstance = (createOllama as any).mock.results[0].value;
    expect(ollamaInstance.embeddingModel).toHaveBeenCalledWith(
      "qwen3-embedding:0.6b",
    );
  });
});

describe("cosineSimilarity re-export", () => {
  it("should export cosineSimilarity from ai package", () => {
    expect(cosineSimilarity).toBeDefined();
    expect(typeof cosineSimilarity).toBe("function");
  });

  it("should call cosineSimilarity with two arrays", () => {
    const a = [0.1, 0.2, 0.3];
    const b = [0.3, 0.2, 0.1];

    cosineSimilarity(a, b);

    expect(cosineSimilarity).toHaveBeenCalledWith(a, b);
  });
});
