import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { createTestDatabase, seedTestFeed } from "./test-utils/db";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import type { ParsedRssItem } from "./pipeline/types";

vi.mock("node-cron");
vi.mock("./pipeline/poller");
vi.mock("./pipeline/dedup");

describe("createPollScheduler", () => {
  let db: AppDatabase;
  let capturedCallback: (() => Promise<void>) | null = null;
  let mockTaskStop: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    db = createTestDatabase();
    vi.clearAllMocks();
    capturedCallback = null;
    mockTaskStop = null;

    const cronModule = await import("node-cron");
    mockTaskStop = vi.fn();

    vi.mocked(cronModule.default.schedule).mockImplementation(
      (expression: string, callback: any) => {
        capturedCallback = callback;
        return {
          stop: mockTaskStop,
        } as any;
      },
    );
  });

  it("should register a cron task with the configured schedule (AC1.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");

    const config: AppConfig = {
      schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
      feeds: [],
      topics: [],
      llm: { provider: "anthropic", model: "claude-opus-4-6" },
      digest: { recipient: "test@example.com" },
      extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
      assessment: { maxArticleLength: 4000 },
    };

    const logger = pino({ level: "silent" });
    const cronModule = await import("node-cron");

    createPollScheduler(db, config, logger);

    expect(vi.mocked(cronModule.default.schedule)).toHaveBeenCalledWith(
      "0 * * * *",
      expect.any(Function),
    );
  });

  it("should poll all enabled feeds from the database (AC1.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");

    const config: AppConfig = {
      schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
      feeds: [],
      topics: [],
      llm: { provider: "anthropic", model: "claude-opus-4-6" },
      digest: { recipient: "test@example.com" },
      extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
      assessment: { maxArticleLength: 4000 },
    };

    const logger = pino({ level: "silent" });

    const feedId1 = seedTestFeed(db, {
      name: "Feed 1",
      url: "https://example.com/feed1",
      enabled: true,
    });

    const feedId2 = seedTestFeed(db, {
      name: "Feed 2",
      url: "https://example.com/feed2",
      enabled: true,
    });

    seedTestFeed(db, {
      name: "Feed 3 (disabled)",
      url: "https://example.com/feed3",
      enabled: false,
    });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test",
      items: [],
      error: null,
    });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test",
      newCount: 0,
      skippedCount: 0,
    });

    createPollScheduler(db, config, logger);

    if (capturedCallback) {
      await capturedCallback();

      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(pollFeed)).toHaveBeenCalledWith(
        "Feed 1",
        "https://example.com/feed1",
        logger,
      );
      expect(vi.mocked(pollFeed)).toHaveBeenCalledWith(
        "Feed 2",
        "https://example.com/feed2",
        logger,
      );
    }
  });

  it("should continue polling remaining feeds when one feed poll returns error (AC1.4)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");

    const config: AppConfig = {
      schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
      feeds: [],
      topics: [],
      llm: { provider: "anthropic", model: "claude-opus-4-6" },
      digest: { recipient: "test@example.com" },
      extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
      assessment: { maxArticleLength: 4000 },
    };

    const logger = pino({ level: "silent" });

    seedTestFeed(db, {
      name: "Feed 1 (fails)",
      url: "https://example.com/feed1",
      enabled: true,
    });

    seedTestFeed(db, {
      name: "Feed 2 (succeeds)",
      url: "https://example.com/feed2",
      enabled: true,
    });

    const testItem: ParsedRssItem = {
      guid: "1",
      title: "Test",
      url: "http://test",
      publishedAt: null,
      metadata: {},
    };

    vi.mocked(pollFeed)
      .mockResolvedValueOnce({
        feedName: "Feed 1 (fails)",
        items: [],
        error: "Network error",
      })
      .mockResolvedValueOnce({
        feedName: "Feed 2 (succeeds)",
        items: [testItem],
        error: null,
      });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test",
      newCount: 1,
      skippedCount: 0,
    });

    createPollScheduler(db, config, logger);

    if (capturedCallback) {
      await capturedCallback();

      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(deduplicateAndStore)).toHaveBeenCalledTimes(1);
    }
  });

  it("should catch unexpected errors and continue to next feed (AC1.4)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");

    const config: AppConfig = {
      schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
      feeds: [],
      topics: [],
      llm: { provider: "anthropic", model: "claude-opus-4-6" },
      digest: { recipient: "test@example.com" },
      extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
      assessment: { maxArticleLength: 4000 },
    };

    const logger = pino({ level: "silent" });

    seedTestFeed(db, {
      name: "Feed 1",
      url: "https://example.com/feed1",
      enabled: true,
    });

    seedTestFeed(db, {
      name: "Feed 2",
      url: "https://example.com/feed2",
      enabled: true,
    });

    const testItem: ParsedRssItem = {
      guid: "1",
      title: "Test",
      url: "http://test",
      publishedAt: null,
      metadata: {},
    };

    vi.mocked(pollFeed)
      .mockResolvedValueOnce({
        feedName: "Feed 1",
        items: [testItem],
        error: null,
      })
      .mockResolvedValueOnce({
        feedName: "Feed 2",
        items: [],
        error: null,
      });

    vi.mocked(deduplicateAndStore)
      .mockImplementationOnce(() => {
        throw new Error("Database error");
      })
      .mockReturnValueOnce({
        feedName: "Feed 2",
        newCount: 0,
        skippedCount: 0,
      });

    createPollScheduler(db, config, logger);

    if (capturedCallback) {
      await expect(capturedCallback()).resolves.toBeUndefined();

      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(deduplicateAndStore)).toHaveBeenCalledTimes(2);
    }
  });

  it("should return a stop() method that stops the cron task (AC1.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");

    const config: AppConfig = {
      schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
      feeds: [],
      topics: [],
      llm: { provider: "anthropic", model: "claude-opus-4-6" },
      digest: { recipient: "test@example.com" },
      extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
      assessment: { maxArticleLength: 4000 },
    };

    const logger = pino({ level: "silent" });

    const scheduler = createPollScheduler(db, config, logger);
    scheduler.stop();

    if (mockTaskStop) {
      expect(mockTaskStop).toHaveBeenCalled();
    }
  });
});
