import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  seedTestFeed,
  createTestCaller,
} from "../../test-utils/db";
import type { AppDatabase } from "../../db";

describe("feeds router", () => {
  let db: AppDatabase;
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    db = createTestDatabase();
    caller = createTestCaller(db);
  });

  it("should return empty list initially (AC5.1)", async () => {
    const result = await caller.feeds.list();
    expect(result).toEqual([]);
  });

  it("should create a feed and return it (AC5.2)", async () => {
    const created = await caller.feeds.create({
      name: "New Feed",
      url: "https://example.com/rss",
      extractorConfig: {
        bodySelector: "article",
        jsonLd: true,
      },
      pollIntervalMinutes: 30,
      enabled: true,
    });

    expect(created).toMatchObject({
      name: "New Feed",
      url: "https://example.com/rss",
      pollIntervalMinutes: 30,
      enabled: true,
    });
    expect(created.id).toBeDefined();
  });

  it("should list feeds after creation (AC5.2)", async () => {
    seedTestFeed(db, {
      name: "Feed 1",
      url: "https://example.com/feed1",
    });
    seedTestFeed(db, {
      name: "Feed 2",
      url: "https://example.com/feed2",
    });

    const result = await caller.feeds.list();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "Feed 1" });
    expect(result[1]).toMatchObject({ name: "Feed 2" });
  });

  it("should get feed by ID (AC5.2)", async () => {
    const feedId = seedTestFeed(db, { name: "Specific Feed" });

    const result = await caller.feeds.getById({ id: feedId });
    expect(result).toMatchObject({
      id: feedId,
      name: "Specific Feed",
    });
  });

  it("should return null for non-existent feed ID (AC5.2)", async () => {
    const result = await caller.feeds.getById({ id: 9999 });
    expect(result).toBeUndefined();
  });

  it("should update a feed (AC5.2)", async () => {
    const feedId = seedTestFeed(db, { name: "Original Name" });

    const updated = await caller.feeds.update({
      id: feedId,
      name: "Updated Name",
      pollIntervalMinutes: 60,
    });

    expect(updated).toMatchObject({
      id: feedId,
      name: "Updated Name",
      pollIntervalMinutes: 60,
    });

    const fetched = await caller.feeds.getById({ id: feedId });
    expect(fetched?.name).toBe("Updated Name");
  });

  it("should delete a feed (AC5.2)", async () => {
    const feedId = seedTestFeed(db, { name: "To Delete" });

    const result = await caller.feeds.delete({ id: feedId });
    expect(result).toEqual({ success: true });

    const fetched = await caller.feeds.getById({ id: feedId });
    expect(fetched).toBeUndefined();

    const list = await caller.feeds.list();
    expect(list).toHaveLength(0);
  });
});
