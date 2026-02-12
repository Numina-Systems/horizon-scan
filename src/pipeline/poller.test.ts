import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pino from "pino";
import * as pollerModule from "./poller";

describe("pollFeed", () => {
  beforeEach(() => {
    pollerModule.resetParser();
  });

  afterEach(() => {
    pollerModule.resetParser();
  });

  it("should parse a valid RSS feed and return items (AC1.1, AC1.2)", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

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

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.feedName).toBe(feedName);
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
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          title: "Article without GUID",
          link: "https://example.com/no-guid",
          pubDate: "2026-02-12T10:00:00Z",
        },
      ],
    });

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("https://example.com/no-guid");
  });

  it("should use empty string as GUID when neither guid nor link is present", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          title: "Article without GUID or link",
          pubDate: "2026-02-12T10:00:00Z",
        },
      ],
    });

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.guid).toBe("");
  });

  it("should handle null title and publishedAt gracefully", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

    const mockParseURL = vi.fn().mockResolvedValue({
      items: [
        {
          guid: "item-1",
          link: "https://example.com/article1",
        },
      ],
    });

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBeNull();
    expect(result.items[0]!.publishedAt).toBeNull();
  });

  it("should catch network errors and return error in result (AC1.4)", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/invalid";

    const mockParseURL = vi.fn().mockRejectedValue(
      new Error("Network error: DNS resolution failed"),
    );

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.feedName).toBe(feedName);
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Network error: DNS resolution failed");
  });

  it("should catch malformed XML errors and return error in result (AC1.4)", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/malformed";

    const mockParseURL = vi.fn().mockRejectedValue(
      new Error("Invalid XML: unexpected token <"),
    );

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.feedName).toBe(feedName);
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Invalid XML: unexpected token <");
  });

  it("should handle non-Error throws and convert to string", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

    const mockParseURL = vi.fn().mockRejectedValue("Unknown error object");

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.feedName).toBe(feedName);
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe("Unknown error object");
  });

  it("should include only present custom namespace fields in metadata", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

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

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.metadata).toEqual({
      prnIndustry: "Finance",
    });
    expect(result.items[0]!.metadata).not.toHaveProperty("prnSubject");
    expect(result.items[0]!.metadata).not.toHaveProperty("dcContributor");
  });

  it("should call parser.parseURL with the correct feedUrl", async () => {
    const feedName = "Test Feed";
    const feedUrl = "https://example.com/rss";

    const mockParseURL = vi.fn().mockResolvedValue({ items: [] });

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(mockParseURL).toHaveBeenCalledWith(feedUrl);
  });

  it("should return zero items on empty feed", async () => {
    const feedName = "Empty Feed";
    const feedUrl = "https://example.com/empty";

    const mockParseURL = vi.fn().mockResolvedValue({ items: [] });

    const mockParser = { parseURL: mockParseURL } as any;
    pollerModule.setParserInstance(mockParser);

    const logger = pino({ level: "silent" });
    const result = await pollerModule.pollFeed(feedName, feedUrl, logger);

    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(0);
  });
});
