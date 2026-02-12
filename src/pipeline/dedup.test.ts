import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { eq } from "drizzle-orm";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
import { articles } from "../db/schema";
import { deduplicateAndStore } from "./dedup";
import type { ParsedRssItem } from "./types";

const logger = pino({ level: "silent" });

describe("deduplicateAndStore", () => {
  it("should insert new articles with correct fields and pending_assessment status", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const items: Array<ParsedRssItem> = [
      {
        guid: "article-1",
        title: "Test Article 1",
        url: "https://example.com/article-1",
        publishedAt: new Date("2024-01-01T12:00:00Z"),
        metadata: { prnIndustry: "Technology", prnSubject: "AI" },
      },
      {
        guid: "article-2",
        title: "Test Article 2",
        url: "https://example.com/article-2",
        publishedAt: new Date("2024-01-02T12:00:00Z"),
        metadata: {},
      },
    ];

    const result = deduplicateAndStore(db, feedId, "Test Feed", items, logger);

    expect(result.feedName).toBe("Test Feed");
    expect(result.newCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const inserted = db.select().from(articles).all();
    expect(inserted).toHaveLength(2);

    const article1 = inserted[0];
    expect(article1).toBeDefined();
    expect(article1!.guid).toBe("article-1");
    expect(article1!.title).toBe("Test Article 1");
    expect(article1!.url).toBe("https://example.com/article-1");
    expect(article1!.publishedAt).toEqual(new Date("2024-01-01T12:00:00Z"));
    expect(article1!.metadata).toEqual({
      prnIndustry: "Technology",
      prnSubject: "AI",
    });
    expect(article1!.status).toBe("pending_assessment");
    expect(article1!.feedId).toBe(feedId);

    const article2 = inserted[1];
    expect(article2).toBeDefined();
    expect(article2!.guid).toBe("article-2");
    expect(article2!.title).toBe("Test Article 2");
    expect(article2!.metadata).toEqual({});
    expect(article2!.status).toBe("pending_assessment");
  });

  it("should insert all new items when no duplicates exist", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const items: Array<ParsedRssItem> = [
      {
        guid: "new-1",
        title: "New Article 1",
        url: "https://example.com/new-1",
        publishedAt: new Date("2024-01-01T00:00:00Z"),
        metadata: {},
      },
      {
        guid: "new-2",
        title: "New Article 2",
        url: "https://example.com/new-2",
        publishedAt: null,
        metadata: { source: "rss" },
      },
      {
        guid: "new-3",
        title: null,
        url: "https://example.com/new-3",
        publishedAt: new Date("2024-01-03T00:00:00Z"),
        metadata: {},
      },
    ];

    const result = deduplicateAndStore(db, feedId, "Test Feed", items, logger);

    expect(result.newCount).toBe(3);
    expect(result.skippedCount).toBe(0);

    const inserted = db.select().from(articles).all();
    expect(inserted).toHaveLength(3);
    expect(inserted.map((a) => a.guid)).toEqual(["new-1", "new-2", "new-3"]);
  });

  it("should skip duplicate articles by GUID without throwing error", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const item1: ParsedRssItem = {
      guid: "duplicate-guid",
      title: "Article Title",
      url: "https://example.com/article",
      publishedAt: new Date("2024-01-01T00:00:00Z"),
      metadata: {},
    };

    // First insertion
    const result1 = deduplicateAndStore(db, feedId, "Test Feed", [item1], logger);
    expect(result1.newCount).toBe(1);
    expect(result1.skippedCount).toBe(0);

    // Second insertion with same GUID
    const result2 = deduplicateAndStore(
      db,
      feedId,
      "Test Feed",
      [item1],
      logger,
    );
    expect(result2.newCount).toBe(0);
    expect(result2.skippedCount).toBe(1);

    // Should only have one article in database
    const allArticles = db.select().from(articles).all();
    expect(allArticles).toHaveLength(1);
  });

  it("should handle mixed new and duplicate items correctly", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const firstBatch: Array<ParsedRssItem> = [
      {
        guid: "article-existing-1",
        title: "Existing 1",
        url: "https://example.com/existing-1",
        publishedAt: new Date("2024-01-01T00:00:00Z"),
        metadata: {},
      },
      {
        guid: "article-existing-2",
        title: "Existing 2",
        url: "https://example.com/existing-2",
        publishedAt: null,
        metadata: {},
      },
    ];

    const secondBatch: Array<ParsedRssItem> = [
      {
        guid: "article-existing-1",
        title: "Existing 1 (duplicate)",
        url: "https://example.com/existing-1-alt",
        publishedAt: new Date("2024-01-01T00:00:00Z"),
        metadata: {},
      },
      {
        guid: "article-new-3",
        title: "New 3",
        url: "https://example.com/new-3",
        publishedAt: new Date("2024-01-03T00:00:00Z"),
        metadata: {},
      },
      {
        guid: "article-existing-2",
        title: "Existing 2 (duplicate)",
        url: "https://example.com/existing-2-alt",
        publishedAt: null,
        metadata: {},
      },
      {
        guid: "article-new-4",
        title: "New 4",
        url: "https://example.com/new-4",
        publishedAt: new Date("2024-01-04T00:00:00Z"),
        metadata: {},
      },
    ];

    // First batch: 2 new articles
    const result1 = deduplicateAndStore(
      db,
      feedId,
      "Test Feed",
      firstBatch,
      logger,
    );
    expect(result1.newCount).toBe(2);
    expect(result1.skippedCount).toBe(0);

    // Second batch: 2 duplicates, 2 new
    const result2 = deduplicateAndStore(
      db,
      feedId,
      "Test Feed",
      secondBatch,
      logger,
    );
    expect(result2.newCount).toBe(2);
    expect(result2.skippedCount).toBe(2);

    // Database should have 4 articles total
    const allArticles = db.select().from(articles).all();
    expect(allArticles).toHaveLength(4);

    const guids = allArticles.map((a) => a.guid).sort();
    expect(guids).toEqual([
      "article-existing-1",
      "article-existing-2",
      "article-new-3",
      "article-new-4",
    ]);
  });

  it("should handle empty items array", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const result = deduplicateAndStore(db, feedId, "Test Feed", [], logger);

    expect(result.newCount).toBe(0);
    expect(result.skippedCount).toBe(0);

    const allArticles = db.select().from(articles).all();
    expect(allArticles).toHaveLength(0);
  });

  it("should handle items with all duplicates", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const items: Array<ParsedRssItem> = [
      {
        guid: "dup-1",
        title: "Duplicate 1",
        url: "https://example.com/dup-1",
        publishedAt: new Date("2024-01-01T00:00:00Z"),
        metadata: {},
      },
      {
        guid: "dup-2",
        title: "Duplicate 2",
        url: "https://example.com/dup-2",
        publishedAt: new Date("2024-01-02T00:00:00Z"),
        metadata: {},
      },
    ];

    // First pass: insert items
    const result1 = deduplicateAndStore(db, feedId, "Test Feed", items, logger);
    expect(result1.newCount).toBe(2);
    expect(result1.skippedCount).toBe(0);

    // Second pass: all items are duplicates
    const result2 = deduplicateAndStore(db, feedId, "Test Feed", items, logger);
    expect(result2.newCount).toBe(0);
    expect(result2.skippedCount).toBe(2);

    const allArticles = db.select().from(articles).all();
    expect(allArticles).toHaveLength(2);
  });

  it("should store article with null title and publishedAt", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const item: ParsedRssItem = {
      guid: "no-metadata-article",
      title: null,
      url: "https://example.com/article",
      publishedAt: null,
      metadata: {},
    };

    deduplicateAndStore(db, feedId, "Test Feed", [item], logger);

    const stored = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "no-metadata-article"))
      .get();

    expect(stored).toBeDefined();
    expect(stored?.title).toBeNull();
    expect(stored?.publishedAt).toBeNull();
    expect(stored?.status).toBe("pending_assessment");
  });

  it("should associate articles with correct feed ID", () => {
    const db = createTestDatabase();
    const feed1 = seedTestFeed(db, { name: "Feed 1" });
    const feed2 = seedTestFeed(db, { name: "Feed 2" });

    const item1: ParsedRssItem = {
      guid: "feed1-article",
      title: "Feed 1 Article",
      url: "https://example.com/feed1",
      publishedAt: null,
      metadata: {},
    };

    const item2: ParsedRssItem = {
      guid: "feed2-article",
      title: "Feed 2 Article",
      url: "https://example.com/feed2",
      publishedAt: null,
      metadata: {},
    };

    deduplicateAndStore(db, feed1, "Feed 1", [item1], logger);
    deduplicateAndStore(db, feed2, "Feed 2", [item2], logger);

    const feed1Articles = db
      .select()
      .from(articles)
      .where(eq(articles.feedId, feed1))
      .all();
    const feed2Articles = db
      .select()
      .from(articles)
      .where(eq(articles.feedId, feed2))
      .all();

    expect(feed1Articles).toHaveLength(1);
    expect(feed1Articles[0]!.guid).toBe("feed1-article");
    expect(feed1Articles[0]!.feedId).toBe(feed1);

    expect(feed2Articles).toHaveLength(1);
    expect(feed2Articles[0]!.guid).toBe("feed2-article");
    expect(feed2Articles[0]!.feedId).toBe(feed2);
  });

  it("should preserve complex metadata structures", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);

    const item: ParsedRssItem = {
      guid: "complex-metadata-article",
      title: "Article with Complex Metadata",
      url: "https://example.com/article",
      publishedAt: new Date("2024-01-01T00:00:00Z"),
      metadata: {
        prnIndustry: "Technology",
        prnSubject: "Artificial Intelligence",
        dcContributor: "John Doe",
        customField: "custom-value",
        nested: {
          level1: {
            level2: "deep-value",
          },
        },
        arrayField: ["value1", "value2"],
        numberField: 42,
        boolField: true,
      },
    };

    deduplicateAndStore(db, feedId, "Test Feed", [item], logger);

    const stored = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "complex-metadata-article"))
      .get();

    expect(stored).toBeDefined();
    expect(stored!.metadata).toEqual(item.metadata);
  });
});
