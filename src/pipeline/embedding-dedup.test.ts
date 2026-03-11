import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase, seedTestFeed, seedTestArticle, createTestConfig } from "../test-utils/db";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { processPendingDedup } from "./embedding-dedup";
import { articles } from "../db/schema";
import { eq } from "drizzle-orm";
import pino from "pino";
import type { EmbeddingModel } from "ai";

// Mock the embedding module
vi.mock("../embedding", () => ({
  prepareEmbeddingInput: vi.fn(),
  generateEmbedding: vi.fn(),
  cosineSimilarity: vi.fn(),
}));

describe("processPendingDedup", () => {
  let db: AppDatabase;
  let config: AppConfig;
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    db = createTestDatabase();
    config = {
      ...createTestConfig(),
      dedup: { similarityThreshold: 0.9, defaultLookbackDays: 15 },
    };
    vi.clearAllMocks();
  });

  it("returns zero counts when no pending articles", async () => {
    const model = {} as EmbeddingModel;
    const result = await processPendingDedup(db, model, config, logger);

    expect(result.processedCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.passedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  describe("AC1.1: Embedding generation with title and body", () => {
    it("calls prepareEmbeddingInput with article title and extractedText", async () => {
      const { prepareEmbeddingInput, generateEmbedding } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);

      mockPrepare.mockReturnValue("prepared text");
      mockGenerate.mockResolvedValue(new Array(768).fill(0.5));

      const feedId = seedTestFeed(db);
      seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Test Title",
        extractedText: "Test body content",
      });

      const model = {} as EmbeddingModel;
      await processPendingDedup(db, model, config, logger);

      expect(mockPrepare).toHaveBeenCalledWith({
        title: "Test Title",
        body: "Test body content",
      });
    });
  });

  describe("AC1.2: 768-dimensional embeddings", () => {
    it("generates 768-dimensional embeddings", async () => {
      const { generateEmbedding } = await import("../embedding");
      const mockGenerate = vi.mocked(generateEmbedding);
      mockGenerate.mockResolvedValue(new Array(768).fill(0.5));

      const feedId = seedTestFeed(db);
      seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Test",
      });

      const model = {} as EmbeddingModel;
      await processPendingDedup(db, model, config, logger);

      expect(mockGenerate).toHaveBeenCalled();
    });
  });

  describe("AC2.1: Embedding storage in column", () => {
    it("stores embedding as JSON array in articles.embedding", async () => {
      const { generateEmbedding, prepareEmbeddingInput } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);

      const testEmbedding = new Array(768).fill(0.1);
      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(testEmbedding);

      const feedId = seedTestFeed(db);
      const articleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Test",
      });

      const model = {} as EmbeddingModel;
      await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, articleId)).get();

      expect(article?.embedding).toBeDefined();
      expect(Array.isArray(article?.embedding)).toBe(true);
      expect((article?.embedding as ReadonlyArray<number>).length).toBe(768);
    });
  });

  describe("AC2.2: Atomic embedding and status update", () => {
    it("updates both embedding and status in same operation", async () => {
      const { generateEmbedding, prepareEmbeddingInput } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);

      const testEmbedding = new Array(768).fill(0.1);
      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(testEmbedding);

      const feedId = seedTestFeed(db);
      const articleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Test",
      });

      const model = {} as EmbeddingModel;
      await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, articleId)).get();

      // Both embedding and status should be updated
      expect(article?.embedding).toBeDefined();
      expect(article?.status).not.toBe("pending_dedup");
    });
  });

  describe("AC3.1: Similarity >= 0.90 marks duplicate", () => {
    it("marks article as duplicate when similarity >= threshold", async () => {
      const { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);
      const mockSimilarity = vi.mocked(cosineSimilarity);

      const recentEmbedding = new Array(768).fill(0.5);
      const newEmbedding = new Array(768).fill(0.5);

      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(newEmbedding);
      mockSimilarity.mockReturnValue(0.95); // >= 0.9

      const feedId = seedTestFeed(db);

      // Seed a recent article with embedding
      seedTestArticle(db, feedId, {
        status: "assessed",
        title: "Old Article",
        embedding: recentEmbedding,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      // Seed pending article
      const pendingArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "New Article",
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, pendingArticleId)).get();

      expect(article?.status).toBe("duplicate");
      expect(result.duplicateCount).toBe(1);
      expect(result.passedCount).toBe(0);
    });
  });

  describe("AC3.2: Similarity < 0.90 transitions to pending_assessment", () => {
    it("marks article as pending_assessment when similarity < threshold", async () => {
      const { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);
      const mockSimilarity = vi.mocked(cosineSimilarity);

      const recentEmbedding = new Array(768).fill(0.5);
      const newEmbedding = new Array(768).fill(0.1);

      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(newEmbedding);
      mockSimilarity.mockReturnValue(0.5); // < 0.9

      const feedId = seedTestFeed(db);

      // Seed a recent article with embedding
      seedTestArticle(db, feedId, {
        status: "assessed",
        title: "Old Article",
        embedding: recentEmbedding,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      // Seed pending article
      const pendingArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "New Article",
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, pendingArticleId)).get();

      expect(article?.status).toBe("pending_assessment");
      expect(result.passedCount).toBe(1);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe("AC3.3: Lookback window filters old articles", () => {
    it("excludes articles outside default lookback window", async () => {
      const { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);
      const mockSimilarity = vi.mocked(cosineSimilarity);

      const recentEmbedding = new Array(768).fill(0.5);
      const newEmbedding = new Array(768).fill(0.5);

      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(newEmbedding);
      mockSimilarity.mockReturnValue(0.95); // Would be duplicate if compared

      const feedId = seedTestFeed(db);

      // Seed an article older than 15-day lookback
      seedTestArticle(db, feedId, {
        status: "assessed",
        title: "Old Article",
        embedding: recentEmbedding,
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days old
      });

      // Seed pending article
      const pendingArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "New Article",
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, pendingArticleId)).get();

      // Should NOT be marked duplicate because old article is outside lookback window
      expect(article?.status).toBe("pending_assessment");
      expect(result.passedCount).toBe(1);
      expect(mockSimilarity).not.toHaveBeenCalled();
    });
  });

  describe("AC3.4: Per-feed lookback override", () => {
    it("respects feed-level dedupLookbackDays override", async () => {
      const { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);
      const mockSimilarity = vi.mocked(cosineSimilarity);

      const recentEmbedding = new Array(768).fill(0.5);
      const newEmbedding = new Array(768).fill(0.5);

      mockPrepare.mockReturnValue("test");
      mockGenerate.mockResolvedValue(newEmbedding);
      mockSimilarity.mockReturnValue(0.95);

      // Feed with 5-day lookback
      const feedId = seedTestFeed(db, { dedupLookbackDays: 5 });

      // Seed an article 10 days old (outside 5-day window but inside 15-day default)
      seedTestArticle(db, feedId, {
        status: "assessed",
        title: "Old Article",
        embedding: recentEmbedding,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      });

      // Seed pending article
      const pendingArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "New Article",
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, pendingArticleId)).get();

      // Should NOT be marked duplicate because of per-feed 5-day window
      expect(article?.status).toBe("pending_assessment");
      expect(result.passedCount).toBe(1);
      expect(mockSimilarity).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("skips embedding generation when title and extractedText are both null", async () => {
      const { generateEmbedding, prepareEmbeddingInput } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);

      mockPrepare.mockReturnValue("");
      // Don't need to mock generateEmbedding since it should be skipped

      const feedId = seedTestFeed(db);
      const articleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: null,
        extractedText: null,
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      const article = db.select().from(articles).where(eq(articles.id, articleId)).get();

      // Should transition to pending_assessment without embedding
      expect(article?.status).toBe("pending_assessment");
      expect(article?.embedding).toBeNull();
      expect(result.passedCount).toBe(1);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("processes multiple pending articles in batch", async () => {
      const { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } = await import("../embedding");
      const mockGenerate = vi.mocked(generateEmbedding);
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockSimilarity = vi.mocked(cosineSimilarity);

      const testEmbedding = new Array(768).fill(0.1);
      mockPrepare.mockImplementation((input) => {
        const title = input.title ?? "";
        const body = (input.body ?? "").slice(0, 1000);
        return `${title}\n${body}`.trim();
      });
      mockGenerate.mockResolvedValue(testEmbedding);
      mockSimilarity.mockReturnValue(0.5); // Low similarity, all pass

      const feedId = seedTestFeed(db);

      // Create multiple pending articles with text content
      seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Article 1",
        extractedText: "Content 1",
      });
      seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Article 2",
        extractedText: "Content 2",
      });
      seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Article 3",
        extractedText: "Content 3",
      });

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      expect(result.processedCount).toBe(3);
      expect(result.passedCount).toBe(3);
      expect(mockGenerate).toHaveBeenCalledTimes(3);
    });

    it("handles embedding generation errors gracefully", async () => {
      const { generateEmbedding, prepareEmbeddingInput } = await import("../embedding");
      const mockPrepare = vi.mocked(prepareEmbeddingInput);
      const mockGenerate = vi.mocked(generateEmbedding);

      mockPrepare.mockReturnValue("test");
      mockGenerate.mockRejectedValueOnce(new Error("embedding service unavailable"));

      const feedId = seedTestFeed(db);

      // Seed one article that will fail
      const failedArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Will Fail",
        extractedText: "Content",
      });

      // Seed another article that should succeed
      const successArticleId = seedTestArticle(db, feedId, {
        status: "pending_dedup",
        title: "Will Succeed",
        extractedText: "Content",
      });

      mockGenerate.mockResolvedValueOnce(new Array(768).fill(0.1));

      const model = {} as EmbeddingModel;
      const result = await processPendingDedup(db, model, config, logger);

      // Failed article should remain in pending_dedup
      const failedArticle = db.select().from(articles).where(eq(articles.id, failedArticleId)).get();
      expect(failedArticle?.status).toBe("pending_dedup");
      expect(failedArticle?.embedding).toBeNull();

      // Successful article should be transitioned
      const successArticle = db.select().from(articles).where(eq(articles.id, successArticleId)).get();
      expect(successArticle?.status).toBe("pending_assessment");
      expect(successArticle?.embedding).toBeDefined();

      // Result counts should reflect both processed and failed
      expect(result.failedCount).toBe(1);
      expect(result.processedCount).toBe(1);
      expect(result.passedCount).toBe(1);
    });
  });
});
