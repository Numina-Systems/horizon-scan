import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";

vi.mock("rss-parser");

describe("pollFeed", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the parser instance in the poller module
    vi.resetModules();
  });

  it("should parse a valid RSS feed and return items (AC1.1, AC1.2)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          guid: "item-1",
          title: "First Article",
          link: "https://example.com/article1",
          pubDate: "2026-02-12T10:00:00Z",
          prnIndustry: "Technology",
          prnSubject: "AI",
          dcContributor: "John Doe",
        },
        {
          guid: "item-2",
          title: "Second Article",
          link: "https://example.com/article2",
          pubDate: "2026-02-12T11:00:00Z",
        },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.feedName).toBe("Test Feed");
    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(2);

    expect(result.items[0]).toEqual({
      guid: "item-1",
      title: "First Article",
      url: "https://example.com/article1",
      publishedAt: new Date("2026-02-12T10:00:00Z"),
      metadata: {
        prnIndustry: "Technology",
        prnSubject: "AI",
        dcContributor: "John Doe",
      },
    });

    expect(result.items[1]).toEqual({
      guid: "item-2",
      title: "Second Article",
      url: "https://example.com/article2",
      publishedAt: new Date("2026-02-12T11:00:00Z"),
      metadata: {},
    });

    expect(result.skippedItems).toHaveLength(0);
  });

  it("should use link as GUID fallback when guid is not present (AC1.2)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          title: "Article without GUID",
          link: "https://example.com/no-guid",
          pubDate: "2026-02-12T10:00:00Z",
        },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("https://example.com/no-guid");
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should reject items missing both guid and link (AC.E.1, AC.E.3)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          title: "Article without GUID or link",
          pubDate: "2026-02-12T10:00:00Z",
        },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const warnSpy = vi.spyOn(logger, "warn");
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(1);
    expect(result.skippedItems[0]!.title).toBe("Article without GUID or link");
    expect(result.skippedItems[0]!.reason).toBe("missing both guid and link");

    // AC.E.3: structured warning logged with feedName, title, reason
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      { feedName: "Test Feed", title: "Article without GUID or link", reason: "missing both guid and link" },
      "skipping RSS item without usable identity or article URL",
    );
  });

  it("should handle null title and publishedAt gracefully", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          guid: "item-1",
          link: "https://example.com/article1",
        },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBeNull();
    expect(result.items[0]!.publishedAt).toBeNull();
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should catch network errors and return error in result (AC1.4)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockRejectedValue(
      new Error("Network error: DNS resolution failed"),
    );

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/invalid", logger);

    expect(result.feedName).toBe("Test Feed");
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Network error: DNS resolution failed");
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should catch malformed XML errors and return error in result (AC1.4)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockRejectedValue(
      new Error("Invalid XML: unexpected token <"),
    );

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/malformed", logger);

    expect(result.feedName).toBe("Test Feed");
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Invalid XML: unexpected token <");
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should handle non-Error throws and convert to string", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockRejectedValue("Unknown error object");

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.feedName).toBe("Test Feed");
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Unknown error object");
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should include only present custom namespace fields in metadata", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          guid: "item-1",
          title: "Article with partial metadata",
          link: "https://example.com/article1",
          pubDate: "2026-02-12T10:00:00Z",
          prnIndustry: "Finance",
        },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.metadata).toEqual({
      prnIndustry: "Finance",
    });
    expect(result.items[0]!.metadata).not.toHaveProperty("prnSubject");
    expect(result.items[0]!.metadata).not.toHaveProperty("dcContributor");
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should call parser.parseURL with the correct feedUrl", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({ items: [] });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(mockParseURL).toHaveBeenCalledWith("https://example.com/rss");
  });

  it("should return zero items on empty feed", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({ items: [] });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Empty Feed", "https://example.com/empty", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(0);
  });

  it("should reject multiple identifier-less items in the same feed (AC.E.1)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        { title: "No ID 1" },
        { title: "No ID 2", pubDate: "2026-02-12T10:00:00Z" },
        { guid: "has-guid", title: "Valid Item", link: "https://example.com/valid" },
        { title: "No ID 3" },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("has-guid");
    expect(result.skippedItems).toHaveLength(3);
    expect(result.skippedItems.map((s) => s.title)).toEqual([
      "No ID 1",
      "No ID 2",
      "No ID 3",
    ]);
    expect(result.skippedItems.every((s) => s.reason === "missing both guid and link")).toBe(true);
  });

  it("should reject identifier-less entries independently across two feeds (AC.E.1 cross-feed)", async () => {
    const Parser = (await import("rss-parser")).default;

    const mockParseURL = vi.fn()
      .mockResolvedValueOnce({ items: [{ title: "Feed A no-ID item" }] })
      .mockResolvedValueOnce({ items: [{ title: "Feed B no-ID item" }] });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });

    const resultA = await pollFeed("Feed A", "https://feed-a.example.com/rss", logger);
    const resultB = await pollFeed("Feed B", "https://feed-b.example.com/rss", logger);

    // Both feeds reject their entries — no cross-feed collision
    expect(resultA.error).toBeNull();
    expect(resultA.items).toHaveLength(0);
    expect(resultA.skippedItems).toHaveLength(1);
    expect(resultA.skippedItems[0]!.title).toBe("Feed A no-ID item");

    expect(resultB.error).toBeNull();
    expect(resultB.items).toHaveLength(0);
    expect(resultB.skippedItems).toHaveLength(1);
    expect(resultB.skippedItems[0]!.title).toBe("Feed B no-ID item");
  });

  it("should reject items with guid but no usable URL (AC.E.3)", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        { guid: "non-url-guid-123", title: "Has GUID, no link" },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const warnSpy = vi.spyOn(logger, "warn");
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(1);
    expect(result.skippedItems[0]!.title).toBe("Has GUID, no link");
    expect(result.skippedItems[0]!.reason).toBe("guid is not a URL and link is missing");

    // AC.E.3: structured warning logged
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      { feedName: "Test Feed", title: "Has GUID, no link", reason: "guid is not a URL and link is missing" },
      "skipping RSS item without usable identity or article URL",
    );
  });

  it("should accept items where guid is a URL even when link is missing", async () => {
    const Parser = (await import("rss-parser")).default;
    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        { guid: "https://example.com/article-via-guid", title: "URL-guid item", pubDate: "2026-02-12T10:00:00Z" },
      ],
    });

    const mockParserInstance = { parseURL: mockParseURL };
    vi.mocked(Parser).mockImplementation(function () {
      return mockParserInstance as any;
    });

    const { pollFeed } = await import("./poller");
    const logger = pino({ level: "silent" });
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.skippedItems).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("https://example.com/article-via-guid");
    expect(result.items[0]!.url).toBe("https://example.com/article-via-guid");
  });
});
