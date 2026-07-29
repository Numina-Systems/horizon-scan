import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTestDatabase,
  seedTestFeed,
  createTestCaller,
} from "../../test-utils/db";
import type { AppDatabase } from "../../db";

vi.mock("../../security/url-validator", () => ({
  validateOutboundUrl: vi.fn(),
}));

describe("feeds router", () => {
  let db: AppDatabase;
  let caller: ReturnType<typeof createTestCaller>;
  let validateOutboundUrl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createTestDatabase();
    caller = createTestCaller(db, {}, {
      authKey: "test-key",
      principal: { id: "test-user", role: "admin" },
    });
    validateOutboundUrl = (await import("../../security/url-validator")).validateOutboundUrl as any;
    // Default: all URLs are valid
    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: true,
      resolvedIp: "93.184.216.34",
    });
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

  // --- New URL validation tests ---

  it("should reject create with private URL (AC.B.1)", async () => {
    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: false,
      reason: "IP address 10.0.0.1 is in a private/reserved range",
    });

    await expect(
      caller.feeds.create({
        name: "Evil",
        url: "http://10.0.0.1/rss",
        extractorConfig: {
          bodySelector: "article",
          jsonLd: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("private"),
    });
  });

  it("should reject create with file:// URL (AC.B.5)", async () => {
    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: false,
      reason: "non-HTTP(S) scheme rejected: file:",
    });

    await expect(
      caller.feeds.create({
        name: "Evil",
        url: "file:///etc/passwd",
        extractorConfig: {
          bodySelector: "article",
          jsonLd: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("non-HTTP"),
    });
  });

  it("should reject update with private URL (AC.B.1)", async () => {
    const feedId = seedTestFeed(db, { name: "Test Feed" });

    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: false,
      reason: "IP address 192.168.1.1 is in a private/reserved range",
    });

    await expect(
      caller.feeds.update({
        id: feedId,
        url: "http://192.168.1.1/rss",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("should allow update without URL field", async () => {
    const feedId = seedTestFeed(db, { name: "Test Feed" });

    const result = await caller.feeds.update({
      id: feedId,
      name: "New Name",
    });

    // validateOutboundUrl should NOT be called when no URL is provided
    expect(validateOutboundUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ name: "New Name" });
  });
});
