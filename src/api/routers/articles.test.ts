import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestArticle,
  createTestCaller,
} from "../../test-utils/db";
import type { AppDatabase } from "../../db";
import type { AppRouter } from "../router";

describe("articles router", () => {
  let db: AppDatabase;
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    db = createTestDatabase();
    caller = createTestCaller(db);
  });

  it("should return empty list initially (AC5.1)", async () => {
    const result = await caller.articles.list({});
    expect(result).toEqual([]);
  });

  it("should list all articles with default pagination (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    seedTestArticle(db, feedId, { title: "Article 1" });
    seedTestArticle(db, feedId, { title: "Article 2" });

    const result = await caller.articles.list({});
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "Article 1" });
    expect(result[1]).toMatchObject({ title: "Article 2" });
  });

  it("should filter articles by feedId (AC5.1)", async () => {
    const feed1Id = seedTestFeed(db, { name: "Feed 1" });
    const feed2Id = seedTestFeed(db, { name: "Feed 2" });

    seedTestArticle(db, feed1Id, { title: "Article in Feed 1" });
    seedTestArticle(db, feed2Id, { title: "Article in Feed 2" });

    const result = await caller.articles.list({ feedId: feed1Id });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      feedId: feed1Id,
      title: "Article in Feed 1",
    });
  });

  it("should filter articles by status (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    seedTestArticle(db, feedId, {
      title: "Pending",
      status: "pending_assessment",
    });
    seedTestArticle(db, feedId, {
      title: "Assessed",
      status: "assessed",
    });

    const result = await caller.articles.list({ status: "assessed" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: "assessed", title: "Assessed" });
  });

  it("should apply limit and offset pagination (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    seedTestArticle(db, feedId, { title: "Article 1" });
    seedTestArticle(db, feedId, { title: "Article 2" });
    seedTestArticle(db, feedId, { title: "Article 3" });

    const page1 = await caller.articles.list({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await caller.articles.list({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(1);
  });

  it("should combine multiple filters (AC5.1)", async () => {
    const feed1Id = seedTestFeed(db, { name: "Feed 1" });
    const feed2Id = seedTestFeed(db, { name: "Feed 2" });

    seedTestArticle(db, feed1Id, {
      title: "Pending in Feed 1",
      status: "pending_assessment",
    });
    seedTestArticle(db, feed1Id, {
      title: "Assessed in Feed 1",
      status: "assessed",
    });
    seedTestArticle(db, feed2Id, {
      title: "Pending in Feed 2",
      status: "pending_assessment",
    });

    const result = await caller.articles.list({
      feedId: feed1Id,
      status: "pending_assessment",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      feedId: feed1Id,
      status: "pending_assessment",
      title: "Pending in Feed 1",
    });
  });

  it("should get article by ID with assessments (AC5.1)", async () => {
    const feedId = seedTestFeed(db);
    const articleId = seedTestArticle(db, feedId, { title: "Test Article" });

    const result = await caller.articles.getById({ id: articleId });
    expect(result).toMatchObject({
      id: articleId,
      title: "Test Article",
      feedId,
    });
    expect(result?.assessments).toBeDefined();
    expect(result?.assessments).toEqual([]);
  });

  it("should return null for non-existent article ID (AC5.1)", async () => {
    const result = await caller.articles.getById({ id: 9999 });
    expect(result).toBeNull();
  });
});
