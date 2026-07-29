import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { createTestDatabase, seedTestFeed } from "./test-utils/db";
import type { AppDatabase } from "./db";
import type { AppConfig } from "./config";
import type { ParsedRssItem } from "./pipeline/types";
import type { SendDigestFn } from "./digest/sender";

vi.mock("node-cron");
vi.mock("./pipeline/poller");
vi.mock("./pipeline/dedup");
vi.mock("./pipeline/embedding-dedup");
vi.mock("./pipeline/fetcher");
vi.mock("./pipeline/extract-articles");
vi.mock("./digest/orchestrator");

const testConfig: AppConfig = {
  schedule: { poll: "0 * * * *", digest: "0 9 * * *" },
  feeds: [],
  topics: [],
  llm: { provider: "anthropic", model: "claude-opus-4-6" },
  digest: { recipient: "test@example.com" },
  extraction: { maxConcurrency: 2, perDomainDelayMs: 1000 },
  assessment: { maxArticleLength: 4000 },
  dedup: { similarityThreshold: 0.9, defaultLookbackDays: 15 },
  shutdown: { drainTimeoutMs: 30000 },
};

const mockSendDigest: SendDigestFn = vi.fn();

describe("createPollScheduler", () => {
  let db: AppDatabase;
  let capturedCallback: (() => Promise<void>) | null = null;
  let mockTaskStop: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    vi.resetModules(); // S1: fresh module = fresh singletons
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

    const logger = pino({ level: "silent" });
    const cronModule = await import("node-cron");

    createPollScheduler(db, testConfig, logger);

    expect(vi.mocked(cronModule.default.schedule)).toHaveBeenCalledWith(
      "0 * * * *",
      expect.any(Function),
    );
  });

  it("should poll all enabled feeds from the database (AC1.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");

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

    seedTestFeed(db, {
      name: "Feed 3 (disabled)",
      url: "https://example.com/feed3",
      enabled: false,
    });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test",
      items: [],
      skippedItems: [],
      error: null,
    });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test",
      newCount: 0,
      skippedCount: 0,
    });

    createPollScheduler(db, testConfig, logger);

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
        skippedItems: [],
        error: "Network error",
      })
      .mockResolvedValueOnce({
        feedName: "Feed 2 (succeeds)",
        items: [testItem],
        skippedItems: [],
        error: null,
      });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test",
      newCount: 1,
      skippedCount: 0,
    });

    createPollScheduler(db, testConfig, logger);

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
        skippedItems: [],
        error: null,
      })
      .mockResolvedValueOnce({
        feedName: "Feed 2",
        items: [],
        skippedItems: [],
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

    createPollScheduler(db, testConfig, logger);

    if (capturedCallback) {
      await expect(capturedCallback()).resolves.toBeUndefined();

      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(deduplicateAndStore)).toHaveBeenCalledTimes(2);
    }
  });

  it("should return a stop() method that stops the cron task (AC1.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");

    const logger = pino({ level: "silent" });

    const scheduler = createPollScheduler(db, testConfig, logger);
    scheduler.stop();

    if (mockTaskStop) {
      expect(mockTaskStop).toHaveBeenCalled();
    }
  });

  it("should call fallbackPendingDedup when embeddingModel is null (AC4.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");
    const { fallbackPendingDedup, processPendingDedup } = await import(
      "./pipeline/embedding-dedup"
    );

    const logger = pino({ level: "silent" });

    seedTestFeed(db, {
      name: "Test Feed",
      url: "https://example.com/feed",
      enabled: true,
    });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test Feed",
      items: [],
      skippedItems: [],
      error: null,
    });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test Feed",
      newCount: 0,
      skippedCount: 0,
    });

    createPollScheduler(db, testConfig, logger, {
      model: null,
      embeddingModel: null,
    });

    if (capturedCallback) {
      await capturedCallback();

      expect(vi.mocked(fallbackPendingDedup)).toHaveBeenCalled();
      expect(vi.mocked(processPendingDedup)).not.toHaveBeenCalled();
    }
  });

  it("should call processPendingDedup when embeddingModel is not null (AC4.1)", async () => {
    const { createPollScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");
    const { deduplicateAndStore } = await import("./pipeline/dedup");
    const { fallbackPendingDedup, processPendingDedup } = await import(
      "./pipeline/embedding-dedup"
    );

    const logger = pino({ level: "silent" });

    seedTestFeed(db, {
      name: "Test Feed",
      url: "https://example.com/feed",
      enabled: true,
    });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test Feed",
      items: [],
      skippedItems: [],
      error: null,
    });

    vi.mocked(deduplicateAndStore).mockReturnValue({
      feedName: "Test Feed",
      newCount: 0,
      skippedCount: 0,
    });

    vi.mocked(processPendingDedup).mockResolvedValue({
      processedCount: 0,
      duplicateCount: 0,
      passedCount: 0,
      failedCount: 0,
    });

    const mockEmbeddingModel = {} as any;

    createPollScheduler(db, testConfig, logger, {
      model: null,
      embeddingModel: mockEmbeddingModel,
    });

    if (capturedCallback) {
      await capturedCallback();

      expect(vi.mocked(processPendingDedup)).toHaveBeenCalledWith(
        db,
        mockEmbeddingModel,
        testConfig,
        logger,
      );
      expect(vi.mocked(fallbackPendingDedup)).not.toHaveBeenCalled();
    }
  });

  // --- Single-flight tests ---

  it("should release poll lock after cycle completes (AC.C.5)", async () => {
    const { createPollScheduler, triggerPollCycle } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");

    const logger = pino({ level: "silent" });

    seedTestFeed(db, { enabled: true });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test",
      items: [],
      skippedItems: [],
      error: null,
    });

    createPollScheduler(db, testConfig, logger);

    // First cycle — acquires and releases lock
    await capturedCallback!();
    expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(1);

    // Second cycle — should succeed because lock was released
    await capturedCallback!();
    expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(2);
  });

  it("should release poll lock even if runPollCycle throws at DB level (AC.C.5)", async () => {
    const { triggerPollCycle } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");

    const logger = pino({ level: "silent" });

    // Create a broken DB where the initial enabled-feeds SELECT throws.
    const brokenDb = {
      select: vi.fn(() => {
        throw new Error("database is closed");
      }),
    } as any;

    // triggerPollCycle rejects — runPollCycle throws, withPollLock releases via finally
    await expect(triggerPollCycle(brokenDb, testConfig, logger)).rejects.toThrow(
      "database is closed",
    );

    // Verify lock was released: call triggerPollCycle with a WORKING db.
    const goodDb = createTestDatabase();
    seedTestFeed(goodDb, {
      name: "Test Feed",
      url: "https://example.com/feed",
      enabled: true,
    });

    vi.mocked(pollFeed).mockResolvedValue({
      feedName: "Test Feed",
      items: [],
      skippedItems: [],
      error: null,
    });

    const result = await triggerPollCycle(goodDb, testConfig, logger);
    expect(result).toEqual({ triggered: true });
  });

  it("should exercise full tRPC triggerPoll path with single-flight (AC.C.1)", async () => {
    const { createTestCaller } = await import("./test-utils/db");
    const { pollFeed } = await import("./pipeline/poller");

    seedTestFeed(db, {
      name: "Test Feed",
      url: "https://example.com/feed",
      enabled: true,
    });

    // Mock pollFeed with a deferred we control — holds runPollCycle open
    let resolvePoll: () => void;
    const pollDeferred = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    vi.mocked(pollFeed).mockImplementationOnce(async () => {
      await pollDeferred;
      return { feedName: "Test Feed", items: [], skippedItems: [], error: null };
    });

    // Create a REAL tRPC caller — NOT mocking triggerPollCycle.
    const caller = createTestCaller(db, undefined, {
      authKey: "test-key",
      principal: { id: "admin", role: "admin" },
    });

    // Start first triggerPoll via real tRPC procedure — acquires lock
    const firstPromise = caller.system.triggerPoll();

    // Wait until pollFeed is called — proves the first call acquired the lock
    await vi.waitFor(() => {
      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(1);
    });

    // Second concurrent triggerPoll should get { triggered: false } — lock is held
    const secondResult = await caller.system.triggerPoll();
    expect(secondResult).toEqual({ triggered: false, reason: "already-running" });

    // Release the deferred — first call completes and releases the lock
    resolvePoll!();
    const firstResult = await firstPromise;
    expect(firstResult).toEqual({ triggered: true });
  });

  it("should reject API trigger while cron poll is running (AC.C.2)", async () => {
    const { createPollScheduler, triggerPollCycle } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");

    const logger = pino({ level: "silent" });

    seedTestFeed(db, { enabled: true });

    let resolvePoll: () => void;
    const pollDeferred = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    vi.mocked(pollFeed).mockImplementationOnce(async () => {
      await pollDeferred;
      return { feedName: "Test", items: [], skippedItems: [], error: null };
    });

    createPollScheduler(db, testConfig, logger);

    // Start the cron callback — acquires the lock, blocks on pollDeferred
    const cronPromise = capturedCallback!();

    // Wait for pollFeed to be called — proves the cron callback holds the lock
    await vi.waitFor(() => {
      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(1);
    });

    // While the cron callback holds the lock, trigger via the API path
    const apiResult = await triggerPollCycle(db, testConfig, logger);
    expect(apiResult).toEqual({ triggered: false, reason: "already-running" });

    // Release the deferred — cron callback completes and releases the lock
    resolvePoll!();
    await cronPromise;

    // Now the API trigger should succeed
    const apiResult2 = await triggerPollCycle(db, testConfig, logger);
    expect(apiResult2).toEqual({ triggered: true });
  });
});

describe("createDigestScheduler", () => {
  let db: AppDatabase;
  let capturedDigestCallback: (() => Promise<void>) | null = null;
  let mockTaskStop: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    vi.resetModules();
    db = createTestDatabase();
    vi.clearAllMocks();
    capturedDigestCallback = null;
    mockTaskStop = null;

    const cronModule = await import("node-cron");
    mockTaskStop = vi.fn();

    // Capture the LAST registered callback (digest scheduler is registered after poll)
    let callbackCount = 0;
    vi.mocked(cronModule.default.schedule).mockImplementation(
      (expression: string, callback: any) => {
        callbackCount++;
        capturedDigestCallback = callback;
        return {
          stop: mockTaskStop,
        } as any;
      },
    );
  });

  it("should skip digest when single-flight is already active (AC.C.4)", async () => {
    const { createDigestScheduler } = await import("./scheduler");
    const { runDigestCycle } = await import("./digest/orchestrator");

    const logger = pino({ level: "silent" });

    let resolveDigest: () => void;
    const digestDeferred = new Promise<void>((resolve) => {
      resolveDigest = resolve;
    });
    vi.mocked(runDigestCycle).mockImplementationOnce(async () => {
      await digestDeferred;
    });

    createDigestScheduler(db, testConfig, mockSendDigest, logger);

    // Start first digest — acquires the lock, blocks on digestDeferred
    const firstPromise = capturedDigestCallback!();
    await vi.waitFor(() =>
      expect(vi.mocked(runDigestCycle)).toHaveBeenCalledTimes(1),
    );

    // Second call while first is suspended — should be rejected by single-flight
    const secondResult = await capturedDigestCallback!();
    expect(secondResult).toBeUndefined();

    // Resolve first call — releases the lock
    resolveDigest!();
    await firstPromise;
    expect(vi.mocked(runDigestCycle)).toHaveBeenCalledTimes(1);
  });

  it("should release digest lock after inner error (F4)", async () => {
    const { createDigestScheduler } = await import("./scheduler");
    const { runDigestCycle } = await import("./digest/orchestrator");

    const logger = pino({ level: "silent" });

    vi.mocked(runDigestCycle).mockRejectedValueOnce(new Error("SMTP failure"));

    createDigestScheduler(db, testConfig, mockSendDigest, logger);

    // Run the cron callback — inner try/catch swallows the error,
    // withDigestLock sees normal completion and releases the lock
    await capturedDigestCallback!();
    expect(vi.mocked(runDigestCycle)).toHaveBeenCalledTimes(1);

    // Run again — lock was released despite the inner error
    await capturedDigestCallback!();
    expect(vi.mocked(runDigestCycle)).toHaveBeenCalledTimes(2);
  });
});

describe("drainScheduler", () => {
  let db: AppDatabase;
  let capturedCallback: (() => Promise<void>) | null = null;
  let mockTaskStop: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    vi.resetModules();
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

  it("drainScheduler resolves immediately when no work is active", async () => {
    const { drainScheduler } = await import("./scheduler");
    await expect(drainScheduler()).resolves.toBeUndefined();
  });

  it("drainScheduler awaits active poll cycle", async () => {
    const { createPollScheduler, drainScheduler } = await import("./scheduler");
    const { pollFeed } = await import("./pipeline/poller");

    const logger = pino({ level: "silent" });
    seedTestFeed(db, { enabled: true });

    let resolvePoll: () => void;
    const pollDeferred = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    vi.mocked(pollFeed).mockImplementationOnce(async () => {
      await pollDeferred;
      return { feedName: "Test", items: [], error: null };
    });

    createPollScheduler(db, testConfig, logger);

    // Start the cron callback — acquires lock, blocks on pollDeferred
    const cronPromise = capturedCallback!();
    await vi.waitFor(() => {
      expect(vi.mocked(pollFeed)).toHaveBeenCalledTimes(1);
    });

    // drainScheduler should not resolve while poll is in-flight
    let drainResolved = false;
    const drainPromise = drainScheduler().then(() => {
      drainResolved = true;
    });

    // Yield to event loop — drain should NOT resolve yet
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(drainResolved).toBe(false);

    // Release poll — drain should now resolve
    resolvePoll!();
    await cronPromise;
    await drainPromise;
    expect(drainResolved).toBe(true);
  });

  it("drainScheduler resolves after error in poll cycle", async () => {
    const { triggerPollCycle, drainScheduler } = await import("./scheduler");

    const logger = pino({ level: "silent" });
    const brokenDb = {
      select: vi.fn(() => {
        throw new Error("db closed");
      }),
    } as any;

    // triggerPollCycle rejects, but withPollLock releases the lock via finally
    await expect(
      triggerPollCycle(brokenDb, testConfig, logger),
    ).rejects.toThrow("db closed");

    // drainScheduler should resolve immediately — no active work
    await expect(drainScheduler()).resolves.toBeUndefined();
  });
});
