import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import { assessPendingArticles } from "./assessor";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
import type { AppConfig } from "../config";
import type { AppDatabase } from "../db";
import { articles, assessments, topics } from "../db/schema";
import { eq } from "drizzle-orm";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((params: unknown) => params),
  },
}));

import { generateText } from "ai";

describe("assessor", () => {
  let db: AppDatabase;
  let mockLogger: Logger;
  let mockModel: LanguageModel;
  let config: AppConfig;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    db = createTestDatabase();
    // Seed a test feed so articles can reference it
    const feedId = seedTestFeed(db);

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    mockModel = {} as LanguageModel;

    config = {
      llm: {
        provider: "anthropic",
        model: "claude-3-haiku",
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
          description: "A test topic",
          enabled: true,
        },
      ],
      schedule: {
        poll: "*/15 * * * *",
        digest: "0 9 * * MON",
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
    };
  });

  it("should assess articles against all active topics", async () => {
    // Seed topics
    db.insert(topics)
      .values([
        {
          name: "Topic 1",
          description: "First topic",
          enabled: true,
        },
        {
          name: "Topic 2",
          description: "Second topic",
          enabled: true,
        },
      ])
      .run();

    // Seed feed
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-1",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "This is test content",
        status: "pending_assessment",
      })
      .run();

    // Mock successful LLM response
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: true,
        summary: "Article is about AI",
        tags: ["AI", "ML"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: false,
        summary: "",
        tags: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was called twice (once per topic)
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);

    // Verify assessments were created
    const allAssessments = db.select().from(assessments).all();
    expect(allAssessments).toHaveLength(2);

    // Verify first assessment (relevant)
    const relevant = allAssessments.find((a) => a.relevant === true);
    expect(relevant).toBeDefined();
    expect(relevant?.summary).toBe("Article is about AI");
    expect(relevant?.tags).toEqual(["AI", "ML"]);

    // Verify second assessment (not relevant)
    const notRelevant = allAssessments.find((a) => a.relevant === false);
    expect(notRelevant).toBeDefined();
    expect(notRelevant?.summary).toBe("");
    expect(notRelevant?.tags).toEqual([]);
  });

  it("should skip article-topic pairs that already have assessments", async () => {
    // Seed two topics
    db.insert(topics)
      .values([
        {
          name: "Topic 1",
          description: "First topic",
          enabled: true,
        },
        {
          name: "Topic 2",
          description: "Second topic",
          enabled: true,
        },
      ])
      .run();

    // Seed article
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-2",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "This is test content",
        status: "pending_assessment",
      })
      .run();

    const articleId = 1;

    // Pre-seed an assessment for this article-topic pair with topic 1
    db.insert(assessments)
      .values({
        articleId,
        topicId: 1,
        relevant: true,
        summary: "Already assessed",
        tags: ["pre-existing"],
        modelUsed: "test-model",
        provider: "anthropic",
        assessedAt: new Date(),
      })
      .run();

    // Mock successful response for topic 2
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: false,
        summary: "",
        tags: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was called only once (for topic 2, not topic 1)
    expect(vi.mocked(generateText)).toHaveBeenCalledOnce();

    // Verify two assessments exist (pre-seeded + new)
    const allAssessments = db.select().from(assessments).all();
    expect(allAssessments).toHaveLength(2);

    // Verify the pre-seeded assessment is unchanged
    const preSeeded = allAssessments.find((a) => a.topicId === 1);
    expect(preSeeded?.summary).toBe("Already assessed");
  });

  it("should increment retry count on LLM failure", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-3",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "This is test content",
        status: "pending_assessment",
        assessmentRetryCount: 0,
      })
      .run();

    const articleId = 1;

    // Mock LLM failure
    vi.mocked(generateText).mockRejectedValueOnce(
      new Error("Rate limit exceeded"),
    );

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify article retry count was incremented
    const updated = db
      .select({
        retryCount: articles.assessmentRetryCount,
        status: articles.status,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();

    expect(updated).toBeDefined();
    expect(updated!.retryCount).toBe(1);
    expect(updated!.status).toBe("pending_assessment");
  });

  it("should mark article as failed after 3 retries", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article with retryCount = 2
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-4",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "This is test content",
        status: "pending_assessment",
        assessmentRetryCount: 2,
      })
      .run();

    const articleId = 1;

    // Mock LLM failure
    vi.mocked(generateText).mockRejectedValueOnce(
      new Error("Timeout"),
    );

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify article status is now 'failed'
    const updated = db
      .select({
        retryCount: articles.assessmentRetryCount,
        status: articles.status,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();

    expect(updated).toBeDefined();
    expect(updated!.retryCount).toBe(3);
    expect(updated!.status).toBe("failed");
  });

  it("should update article status to assessed after successful assessment", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-5",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "This is test content",
        status: "pending_assessment",
      })
      .run();

    const articleId = 1;

    // Mock successful LLM response
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: true,
        summary: "Relevant article",
        tags: ["tag1"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify article status is now 'assessed'
    const updated = db
      .select({ status: articles.status })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("assessed");
  });

  it("should truncate article text to maxArticleLength", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article with very long text
    const longText = "A".repeat(10000);
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-6",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: longText,
        status: "pending_assessment",
      })
      .run();

    // Mock successful response
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: true,
        summary: "Test",
        tags: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was called with truncated text
    const call = vi.mocked(generateText).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = (call as any).prompt as string;

    // The prompt should contain truncated text (max 4000 chars)
    expect(prompt.length).toBeLessThanOrEqual(
      4000 + 100, // 100 char buffer for prompt prefix
    );
  });

  it("should store model used and provider in assessments", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-7",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "Test content",
        status: "pending_assessment",
      })
      .run();

    // Mock successful response
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: true,
        summary: "Test",
        tags: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify assessment contains model and provider
    const assessment = db.select().from(assessments).get();
    expect(assessment?.modelUsed).toBe("claude-3-haiku");
    expect(assessment?.provider).toBe("anthropic");
  });

  it("should not assess disabled topics", async () => {
    // Seed one enabled and one disabled topic
    db.insert(topics)
      .values([
        {
          name: "Enabled Topic",
          description: "This is enabled",
          enabled: true,
        },
        {
          name: "Disabled Topic",
          description: "This is disabled",
          enabled: false,
        },
      ])
      .run();

    // Seed article
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-8",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "Test content",
        status: "pending_assessment",
      })
      .run();

    // Mock response
    vi.mocked(generateText).mockResolvedValueOnce({
      experimental_output: {
        relevant: true,
        summary: "Test",
        tags: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was called only once (for enabled topic)
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);

    // Verify only one assessment exists
    const allAssessments = db.select().from(assessments).all();
    expect(allAssessments).toHaveLength(1);
  });

  it("should handle articles without extractedText", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article without extracted text
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-9",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: null,
        status: "pending_assessment",
      })
      .run();

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was not called
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();

    // Verify no assessments were created
    const allAssessments = db.select().from(assessments).all();
    expect(allAssessments).toHaveLength(0);
  });

  it("should handle empty topic list", async () => {
    // Seed article but no topics
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-10",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "Test content",
        status: "pending_assessment",
      })
      .run();

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was not called
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();

    // Verify no assessments were created
    const allAssessments = db.select().from(assessments).all();
    expect(allAssessments).toHaveLength(0);

    // Verify logger was called
    expect(vi.mocked(mockLogger.info)).toHaveBeenCalledWith(
      "no active topics configured",
    );
  });

  it("should handle articles already at max retry count", async () => {
    // Seed topic
    db.insert(topics)
      .values({
        name: "Topic 1",
        description: "First topic",
        enabled: true,
      })
      .run();

    // Seed article with retryCount = 3 (already maxed out)
    db.insert(articles)
      .values({
        feedId: 1,
        guid: "test-guid-11",
        title: "Test Article",
        url: "https://example.com/article",
        extractedText: "Test content",
        status: "pending_assessment",
        assessmentRetryCount: 3,
      })
      .run();

    await assessPendingArticles(db, mockModel, config, mockLogger);

    // Verify generateText was not called (article excluded by retry count filter)
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });
});
