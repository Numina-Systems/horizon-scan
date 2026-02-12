import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
import { articles, topics, assessments, digests } from "../db/schema";
import { runDigestCycle } from "./orchestrator";
import type { AppConfig } from "../config";
import type { SendResult } from "./sender";

/**
 * Creates a mock Logger instance for testing.
 */
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    level: "info" as const,
    setLevel: vi.fn(),
    child: vi.fn(),
    isLevelEnabled: vi.fn(),
  } as unknown as Logger;
}

const mockConfig: AppConfig = {
  llm: {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
  },
  feeds: [
    {
      name: "Test Feed",
      url: "https://example.com/rss",
      extractorConfig: {
        bodySelector: "article",
        jsonLd: true,
      },
      pollIntervalMinutes: 15,
      enabled: true,
    },
  ],
  topics: [
    {
      name: "Technology",
      description: "Tech news",
      enabled: true,
    },
  ],
  schedule: {
    poll: "0 * * * *",
    digest: "0 9 * * *",
  },
  digest: {
    recipient: "digest@example.com",
  },
  extraction: {
    maxConcurrency: 2,
    perDomainDelayMs: 1000,
  },
  assessment: {
    maxArticleLength: 4000,
  },
};

describe("runDigestCycle", () => {
  it("should send digest and record success when articles are available", async () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();
    const topicId = topicResult.id;

    // Create article
    const articleResult = db
      .insert(articles)
      .values({
        feedId,
        guid: "test-article",
        title: "Test Article",
        url: "https://example.com/article",
        publishedAt: new Date(),
      })
      .returning({ id: articles.id })
      .get();

    // Create relevant assessment
    db.insert(assessments)
      .values({
        articleId: articleResult.id,
        topicId,
        relevant: true,
        summary: "Test summary",
        tags: ["test"],
        modelUsed: "claude-3-5-sonnet",
        provider: "anthropic",
        assessedAt: new Date(),
      })
      .run();

    // Mock sendDigest
    const mockSendDigest = vi.fn(async (): Promise<SendResult> => ({
      success: true,
      messageId: "msg-123",
    }));

    const mockLogger = createMockLogger();

    await runDigestCycle(db, mockConfig, mockSendDigest, mockLogger);

    // Verify sendDigest was called
    expect(mockSendDigest).toHaveBeenCalledOnce();
    expect(mockSendDigest).toHaveBeenCalledWith(
      "digest@example.com",
      expect.stringContaining("1 article"),
      expect.stringContaining("Technology"),
      expect.anything(),
    );

    // Verify digest was recorded
    const digestRows = db.select().from(digests).all();
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0]!.articleCount).toBe(1);
    expect(digestRows[0]!.status).toBe("success");
    expect(digestRows[0]!.recipient).toBe("digest@example.com");

    expect(mockLogger.info).toHaveBeenCalledWith(
      { articleCount: 1 },
      "digest cycle complete",
    );
  });

  it("should skip send but record digest when no relevant articles exist", async () => {
    const db = createTestDatabase();

    const mockSendDigest = vi.fn(async (): Promise<SendResult> => ({
      success: true,
      messageId: "msg-123",
    }));

    const mockLogger = createMockLogger();

    await runDigestCycle(db, mockConfig, mockSendDigest, mockLogger);

    // Verify sendDigest was NOT called
    expect(mockSendDigest).not.toHaveBeenCalled();

    // Verify digest was still recorded with articleCount: 0
    const digestRows = db.select().from(digests).all();
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0]!.articleCount).toBe(0);
    expect(digestRows[0]!.status).toBe("success");

    expect(mockLogger.info).toHaveBeenCalledWith(
      "no relevant articles for digest, skipping email send",
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      "empty digest recorded to advance time window",
    );
  });

  it("should record failed digest when send fails", async () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();
    const topicId = topicResult.id;

    // Create article
    const articleResult = db
      .insert(articles)
      .values({
        feedId,
        guid: "test-article",
        title: "Test Article",
        url: "https://example.com/article",
        publishedAt: new Date(),
      })
      .returning({ id: articles.id })
      .get();

    // Create relevant assessment
    db.insert(assessments)
      .values({
        articleId: articleResult.id,
        topicId,
        relevant: true,
        summary: "Test summary",
        tags: ["test"],
        modelUsed: "claude-3-5-sonnet",
        provider: "anthropic",
        assessedAt: new Date(),
      })
      .run();

    // Mock sendDigest to return failure
    const mockSendDigest = vi.fn(async (): Promise<SendResult> => ({
      success: false,
      error: "Mailgun API error",
    }));

    const mockLogger = createMockLogger();

    await runDigestCycle(db, mockConfig, mockSendDigest, mockLogger);

    // Verify digest was recorded as failed
    const digestRows = db.select().from(digests).all();
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0]!.status).toBe("failed");
    expect(digestRows[0]!.articleCount).toBe(1);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { error: "Mailgun API error" },
      "digest recorded as failed",
    );

    // Verify articles are still queryable for next cycle
    const queryableAssessments = db
      .select()
      .from(assessments)
      .where(eq(assessments.relevant, true))
      .all();
    expect(queryableAssessments).toHaveLength(1);
  });

  it("should only include articles assessed after the last successful digest", async () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();
    const topicId = topicResult.id;

    // Create articles
    const article1Result = db
      .insert(articles)
      .values({
        feedId,
        guid: "article-1",
        title: "Article 1",
        url: "https://example.com/1",
        publishedAt: new Date("2024-01-01"),
      })
      .returning({ id: articles.id })
      .get();

    const article2Result = db
      .insert(articles)
      .values({
        feedId,
        guid: "article-2",
        title: "Article 2",
        url: "https://example.com/2",
        publishedAt: new Date("2024-01-02"),
      })
      .returning({ id: articles.id })
      .get();

    // Create past digest
    const pastDate = new Date("2024-01-10T00:00:00Z");
    db.insert(digests)
      .values({
        sentAt: pastDate,
        articleCount: 1,
        recipient: "digest@example.com",
        status: "success",
      })
      .run();

    // Create assessment before last digest (should be excluded)
    const beforeDate = new Date("2024-01-09T00:00:00Z");
    db.insert(assessments)
      .values({
        articleId: article1Result.id,
        topicId,
        relevant: true,
        summary: "Summary 1",
        tags: ["tag1"],
        modelUsed: "claude-3-5-sonnet",
        provider: "anthropic",
        assessedAt: beforeDate,
      })
      .run();

    // Create assessment after last digest (should be included)
    const afterDate = new Date("2024-01-11T00:00:00Z");
    db.insert(assessments)
      .values({
        articleId: article2Result.id,
        topicId,
        relevant: true,
        summary: "Summary 2",
        tags: ["tag2"],
        modelUsed: "claude-3-5-sonnet",
        provider: "anthropic",
        assessedAt: afterDate,
      })
      .run();

    const mockSendDigest = vi.fn(async (): Promise<SendResult> => ({
      success: true,
      messageId: "msg-123",
    }));

    const mockLogger = createMockLogger();

    await runDigestCycle(db, mockConfig, mockSendDigest, mockLogger);

    // Verify only 1 article was sent
    expect(mockSendDigest).toHaveBeenCalledOnce();

    // Get the actual call to verify article content
    const actualCalls = mockSendDigest.mock.calls as Array<Array<unknown>>;
    expect(actualCalls).toHaveLength(1);
    const subject = actualCalls[0]?.[1] as string;
    const html = actualCalls[0]?.[2] as string;
    expect(subject).toContain("1 article");
    expect(html).toContain("Article 2");
    expect(html).not.toContain("Article 1");

    // Verify digest recorded correct count
    const digestRows = db.select().from(digests).all();
    const newDigest = digestRows[digestRows.length - 1];
    expect(newDigest!.articleCount).toBe(1);
  });
});
