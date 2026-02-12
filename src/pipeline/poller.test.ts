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
  });

  it("should use empty string as GUID when neither guid nor link is present", async () => {
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
    const result = await pollFeed("Test Feed", "https://example.com/rss", logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("");
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
  });
});
