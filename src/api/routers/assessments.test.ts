import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestArticle,
  seedTestTopic,
  seedTestAssessment,
  createTestCaller,
} from "../../test-utils/db";
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
