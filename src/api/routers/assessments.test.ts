import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestArticle,
  seedTestTopic,
  seedTestAssessment,
  createTestCaller,
} from "../../test-utils/db";
import { articles } from "../../db/schema";
import type { AppDatabase } from "../../db";

describe("assessments router", () => {
  let db: AppDatabase;
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    db = createTestDatabase();
    caller = createTestCaller(db);
  });

  it("should return empty list initially (AC5.1)", async () => {
    const result = await caller.assessments.list({});
    expect(result).toEqual([]);
  });

  it("should list all assessments (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true });
    seedTestAssessment(db, article2Id, topicId, { relevant: false });

    const result = await caller.assessments.list({});
    expect(result).toHaveLength(2);
  });

  it("should filter assessments by relevant=true (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const article3Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true });
    seedTestAssessment(db, article2Id, topicId, { relevant: false });
    seedTestAssessment(db, article3Id, topicId, { relevant: true });

    const result = await caller.assessments.list({ relevant: true });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.relevant === true)).toBe(true);
  });

  it("should filter assessments by relevant=false (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const article3Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true });
    seedTestAssessment(db, article2Id, topicId, { relevant: false });
    seedTestAssessment(db, article3Id, topicId, { relevant: false });

    const result = await caller.assessments.list({ relevant: false });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.relevant === false)).toBe(true);
  });

  it("should filter assessments by articleId (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true });
    seedTestAssessment(db, article1Id, topicId, { relevant: false });
    seedTestAssessment(db, article2Id, topicId, { relevant: true });

    const result = await caller.assessments.list({ articleId: article1Id });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.articleId === article1Id)).toBe(true);
  });

  it("should filter assessments by topicId (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const articleId = seedTestArticle(db, feedId);
    const topic1Id = seedTestTopic(db, { name: "Topic 1" });
    const topic2Id = seedTestTopic(db, { name: "Topic 2" });

    seedTestAssessment(db, articleId, topic1Id, { relevant: true });
    seedTestAssessment(db, articleId, topic2Id, { relevant: false });

    const result = await caller.assessments.list({ topicId: topic1Id });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ topicId: topic1Id });
  });

  it("should combine multiple filters: articleId and relevant (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true });
    seedTestAssessment(db, article1Id, topicId, { relevant: false });
    seedTestAssessment(db, article2Id, topicId, { relevant: true });

    const result = await caller.assessments.list({
      articleId: article1Id,
      relevant: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      articleId: article1Id,
      relevant: true,
    });
  });

  it("should combine multiple filters: topicId and relevant (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topic1Id = seedTestTopic(db, { name: "Topic 1" });
    const topic2Id = seedTestTopic(db, { name: "Topic 2" });

    seedTestAssessment(db, article1Id, topic1Id, { relevant: true });
    seedTestAssessment(db, article1Id, topic2Id, { relevant: true });
    seedTestAssessment(db, article2Id, topic1Id, { relevant: false });

    const result = await caller.assessments.list({
      topicId: topic1Id,
      relevant: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      topicId: topic1Id,
      relevant: true,
    });
  });

  it("should combine all three filters: articleId, topicId, and relevant (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topic1Id = seedTestTopic(db, { name: "Topic 1" });
    const topic2Id = seedTestTopic(db, { name: "Topic 2" });

    seedTestAssessment(db, article1Id, topic1Id, { relevant: true });
    seedTestAssessment(db, article1Id, topic2Id, { relevant: true });
    seedTestAssessment(db, article2Id, topic1Id, { relevant: true });

    const result = await caller.assessments.list({
      articleId: article1Id,
      topicId: topic1Id,
      relevant: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      articleId: article1Id,
      topicId: topic1Id,
      relevant: true,
    });
  });

  it("should return empty list when filters match no assessments (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const articleId = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, articleId, topicId, { relevant: true });

    const result = await caller.assessments.list({ relevant: false });
    expect(result).toEqual([]);
  });

  it("should get assessments by article ID (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const article1Id = seedTestArticle(db, feedId);
    const article2Id = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    seedTestAssessment(db, article1Id, topicId, { relevant: true, summary: "Assessment 1" });
    seedTestAssessment(db, article1Id, topicId, { relevant: false, summary: "Assessment 2" });
    seedTestAssessment(db, article2Id, topicId, { relevant: true, summary: "Assessment 3" });

    const result = await caller.assessments.getByArticle({ articleId: article1Id });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.articleId === article1Id)).toBe(true);
    expect(result.map((a) => a.summary)).toEqual([
      "Assessment 1",
      "Assessment 2",
    ]);
  });

  it("should return empty list for article with no assessments (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const articleId = seedTestArticle(db, feedId);

    const result = await caller.assessments.getByArticle({ articleId: articleId });
    expect(result).toEqual([]);
  });

  describe("reassess", () => {
    it("should delete assessments and reset article status for a specific article", async () => {
      const feedId = seedTestFeed(db);
      const articleId = seedTestArticle(db, feedId, { status: "assessed" });
      const topicId = seedTestTopic(db);
      seedTestAssessment(db, articleId, topicId, { relevant: true });

      const result = await caller.assessments.reassess({ articleId });

      expect(result.assessmentsDeleted).toBe(1);
      expect(result.articlesReset).toBe(1);

      const remaining = await caller.assessments.list({ articleId });
      expect(remaining).toHaveLength(0);

      const [article] = db
        .select({ status: articles.status, retryCount: articles.assessmentRetryCount })
        .from(articles)
        .where(eq(articles.id, articleId))
        .all();
      expect(article!.status).toBe("pending_assessment");
      expect(article!.retryCount).toBe(0);
    });

    it("should delete assessments and reset all assessed articles when no articleId given", async () => {
      const feedId = seedTestFeed(db);
      const article1Id = seedTestArticle(db, feedId, { status: "assessed" });
      const article2Id = seedTestArticle(db, feedId, { status: "assessed" });
      const article3Id = seedTestArticle(db, feedId, { status: "pending_assessment" });
      const topicId = seedTestTopic(db);
      seedTestAssessment(db, article1Id, topicId, { relevant: true });
      seedTestAssessment(db, article2Id, topicId, { relevant: false });

      const result = await caller.assessments.reassess({});

      expect(result.assessmentsDeleted).toBe(2);
      expect(result.articlesReset).toBe(2);

      const allAssessments = await caller.assessments.list({});
      expect(allAssessments).toHaveLength(0);

      const statuses = db
        .select({ id: articles.id, status: articles.status })
        .from(articles)
        .all();
      expect(statuses.every((a) => a.status === "pending_assessment")).toBe(true);
    });

    it("should also reset failed articles when includeFailed is true", async () => {
      const feedId = seedTestFeed(db);
      const assessedId = seedTestArticle(db, feedId, { status: "assessed" });
      const failedId = seedTestArticle(db, feedId, { status: "failed", assessmentRetryCount: 3 });
      const topicId = seedTestTopic(db);
      seedTestAssessment(db, assessedId, topicId, { relevant: true });
      seedTestAssessment(db, failedId, topicId, { relevant: false });

      const result = await caller.assessments.reassess({ includeFailed: true });

      expect(result.assessmentsDeleted).toBe(2);
      expect(result.articlesReset).toBe(2);

      const [failed] = db
        .select({ status: articles.status, retryCount: articles.assessmentRetryCount })
        .from(articles)
        .where(eq(articles.id, failedId))
        .all();
      expect(failed!.status).toBe("pending_assessment");
      expect(failed!.retryCount).toBe(0);
    });

    it("should not reset failed articles by default", async () => {
      const feedId = seedTestFeed(db);
      const failedId = seedTestArticle(db, feedId, { status: "failed", assessmentRetryCount: 3 });
      const topicId = seedTestTopic(db);
      seedTestAssessment(db, failedId, topicId, { relevant: false });

      const result = await caller.assessments.reassess({});

      expect(result.assessmentsDeleted).toBe(0);
      expect(result.articlesReset).toBe(0);

      const [failed] = db
        .select({ status: articles.status })
        .from(articles)
        .where(eq(articles.id, failedId))
        .all();
      expect(failed!.status).toBe("failed");
    });

    it("should return zero counts when no articles match", async () => {
      const result = await caller.assessments.reassess({});
      expect(result.assessmentsDeleted).toBe(0);
      expect(result.articlesReset).toBe(0);
    });
  });

  it("should include all assessment fields in response (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const articleId = seedTestArticle(db, feedId);
    const topicId = seedTestTopic(db);

    const assessedAt = new Date();
    seedTestAssessment(db, articleId, topicId, {
      relevant: true,
      summary: "Test Summary",
      tags: ["tag1", "tag2"],
      modelUsed: "claude-3-5-sonnet",
      provider: "anthropic",
      assessedAt,
    });

    const result = await caller.assessments.list({});
    expect(result).toHaveLength(1);
    const assessment = result[0]!;

    expect(assessment).toMatchObject({
      articleId,
      topicId,
      relevant: true,
      summary: "Test Summary",
      tags: ["tag1", "tag2"],
      modelUsed: "claude-3-5-sonnet",
      provider: "anthropic",
    });
    expect(assessment.id).toBeDefined();
    expect(assessment.assessedAt).toBeDefined();
  });
});
