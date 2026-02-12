import { describe, it, expect } from "vitest";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
import { articles, topics, assessments, digests } from "../db/schema";
import { buildDigest } from "./builder";

describe("buildDigest", () => {
  it("should return relevant articles assessed after the last successful digest", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create a topic
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

    // Create a past digest
    const pastDate = new Date("2024-01-10T00:00:00Z");
    db.insert(digests)
      .values({
        sentAt: pastDate,
        articleCount: 1,
        recipient: "test@example.com",
        status: "success",
      })
      .run();

    // Create assessment before digest (should not be included)
    const beforeDate = new Date("2024-01-09T00:00:00Z");
    db.insert(assessments)
      .values({
        articleId: article1Result.id,
        topicId,
        relevant: true,
        summary: "Summary 1",
        tags: ["tag1"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: beforeDate,
      })
      .run();

    // Create assessment after digest (should be included)
    const afterDate = new Date("2024-01-11T00:00:00Z");
    db.insert(assessments)
      .values({
        articleId: article2Result.id,
        topicId,
        relevant: true,
        summary: "Summary 2",
        tags: ["tag2"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: afterDate,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(1);
    expect(result.topicGroups).toHaveLength(1);
    expect(result.topicGroups[0]!.topicName).toBe("Technology");
    expect(result.topicGroups[0]!.articles).toHaveLength(1);
    expect(result.topicGroups[0]!.articles[0]!.title).toBe("Article 2");
    expect(result.topicGroups[0]!.articles[0]!.url).toBe("https://example.com/2");
    expect(result.topicGroups[0]!.articles[0]!.summary).toBe("Summary 2");
    expect(result.topicGroups[0]!.articles[0]!.tags).toEqual(["tag2"]);
  });

  it("should group articles by topic", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create two topics
    const topic1Result = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();

    const topic2Result = db
      .insert(topics)
      .values({
        name: "Business",
        description: "Business news",
      })
      .returning({ id: topics.id })
      .get();

    // Create articles
    const article1Result = db
      .insert(articles)
      .values({
        feedId,
        guid: "article-1",
        title: "Tech Article",
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
        title: "Business Article",
        url: "https://example.com/2",
        publishedAt: new Date("2024-01-02"),
      })
      .returning({ id: articles.id })
      .get();

    // Create assessments for different topics
    const now = new Date();
    db.insert(assessments)
      .values({
        articleId: article1Result.id,
        topicId: topic1Result.id,
        relevant: true,
        summary: "Tech summary",
        tags: ["ai", "ml"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    db.insert(assessments)
      .values({
        articleId: article2Result.id,
        topicId: topic2Result.id,
        relevant: true,
        summary: "Business summary",
        tags: ["market"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(2);
    expect(result.topicGroups).toHaveLength(2);

    const techGroup = result.topicGroups.find((g) => g.topicName === "Technology");
    expect(techGroup).toBeDefined();
    expect(techGroup!.articles).toHaveLength(1);
    expect(techGroup!.articles[0]!.title).toBe("Tech Article");
    expect(techGroup!.articles[0]!.tags).toEqual(["ai", "ml"]);

    const businessGroup = result.topicGroups.find((g) => g.topicName === "Business");
    expect(businessGroup).toBeDefined();
    expect(businessGroup!.articles).toHaveLength(1);
    expect(businessGroup!.articles[0]!.title).toBe("Business Article");
    expect(businessGroup!.articles[0]!.tags).toEqual(["market"]);
  });

  it("should return empty digest when no relevant articles exist in the window", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create a topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();

    // Create an article
    const articleResult = db
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

    // Create a recent digest
    const recentDate = new Date("2024-01-15T00:00:00Z");
    db.insert(digests)
      .values({
        sentAt: recentDate,
        articleCount: 1,
        recipient: "test@example.com",
        status: "success",
      })
      .run();

    // Create assessment before the recent digest (should not be included)
    const beforeDate = new Date("2024-01-10T00:00:00Z");
    db.insert(assessments)
      .values({
        articleId: articleResult.id,
        topicId: topicResult.id,
        relevant: true,
        summary: "Summary",
        tags: ["tag1"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: beforeDate,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(0);
    expect(result.topicGroups).toHaveLength(0);
  });

  it("should include all relevant assessments on first run when no prior digest exists", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create a topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();

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

    // Create assessments (no digest exists yet)
    const now = new Date();
    db.insert(assessments)
      .values({
        articleId: article1Result.id,
        topicId: topicResult.id,
        relevant: true,
        summary: "Summary 1",
        tags: ["tag1"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: new Date(now.getTime() - 100000),
      })
      .run();

    db.insert(assessments)
      .values({
        articleId: article2Result.id,
        topicId: topicResult.id,
        relevant: true,
        summary: "Summary 2",
        tags: ["tag2"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(2);
    expect(result.topicGroups).toHaveLength(1);
    expect(result.topicGroups[0]!.articles).toHaveLength(2);
  });

  it("should include only relevant assessments, excluding non-relevant ones", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create a topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();

    // Create articles
    const article1Result = db
      .insert(articles)
      .values({
        feedId,
        guid: "article-1",
        title: "Relevant Article",
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
        title: "Not Relevant Article",
        url: "https://example.com/2",
        publishedAt: new Date("2024-01-02"),
      })
      .returning({ id: articles.id })
      .get();

    // Create relevant assessment
    const now = new Date();
    db.insert(assessments)
      .values({
        articleId: article1Result.id,
        topicId: topicResult.id,
        relevant: true,
        summary: "Summary 1",
        tags: ["tag1"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    // Create non-relevant assessment
    db.insert(assessments)
      .values({
        articleId: article2Result.id,
        topicId: topicResult.id,
        relevant: false,
        summary: "Summary 2",
        tags: ["tag2"],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(1);
    expect(result.topicGroups[0]!.articles).toHaveLength(1);
    expect(result.topicGroups[0]!.articles[0]!.title).toBe("Relevant Article");
  });

  it("should handle articles with null title and publishedAt", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    // Create a topic
    const topicResult = db
      .insert(topics)
      .values({
        name: "Technology",
        description: "Tech news",
      })
      .returning({ id: topics.id })
      .get();

    // Create article with null fields
    const articleResult = db
      .insert(articles)
      .values({
        feedId,
        guid: "article-1",
        title: null,
        url: "https://example.com/1",
        publishedAt: null,
      })
      .returning({ id: articles.id })
      .get();

    // Create assessment
    const now = new Date();
    db.insert(assessments)
      .values({
        articleId: articleResult.id,
        topicId: topicResult.id,
        relevant: true,
        summary: "Summary",
        tags: [],
        modelUsed: "gpt-4",
        provider: "openai",
        assessedAt: now,
      })
      .run();

    const result = buildDigest(db);

    expect(result.totalArticleCount).toBe(1);
    expect(result.topicGroups[0]!.articles[0]!.title).toBeNull();
    expect(result.topicGroups[0]!.articles[0]!.publishedAt).toBeNull();
  });
});
