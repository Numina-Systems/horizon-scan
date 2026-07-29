import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { fetchArticle, fetchPendingArticles, summarizeSettledResults } from "./fetcher";
import { guardedFetch } from "../security/fetch-guard";
import { createTestDatabase, seedTestFeed, createTestLoggerWithCapture } from "../test-utils/db";
import type { AppDatabase } from "../db";
import { articles } from "../db/schema";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config";

vi.mock("../security/fetch-guard", () => ({
  guardedFetch: vi.fn(),
}));

describe("fetchArticle", () => {
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return success with HTML when fetch returns 200", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: "<html><body>Article content</body></html>",
      finalUrl: "https://example.com/article",
    });

    const result = await fetchArticle("https://example.com/article", 15000, logger);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toBe("<html><body>Article content</body></html>");
      expect(result.url).toBe("https://example.com/article");
    }
  });

  it("should return failure with error message when fetch returns 403", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "HTTP 403: Forbidden",
    });

    const result = await fetchArticle("https://example.com/blocked", 15000, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("403");
      expect(result.url).toBe("https://example.com/blocked");
    }
  });

  it("should return failure with error message when fetch returns 404", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "HTTP 404: Not Found",
    });

    const result = await fetchArticle("https://example.com/missing", 15000, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("404");
    }
  });

  it("should return failure with error message when fetch returns 500", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "HTTP 500: Internal Server Error",
    });

    const result = await fetchArticle("https://example.com/error", 15000, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("500");
    }
  });

  it("should return failure when fetch times out", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "The operation was aborted",
    });

    const result = await fetchArticle("https://example.com/slow", 15000, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("aborted");
    }
  });

  it("should set User-Agent and Accept headers on guardedFetch request", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: "<html></html>",
      finalUrl: "https://example.com/article",
    });

    await fetchArticle("https://example.com/article", 15000, logger);

    expect(guardedFetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          "User-Agent": "HorizonScan/1.0 (RSS article fetcher)",
          Accept: "text/html,application/xhtml+xml",
        },
      }),
    );
  });

  it("should reject SSRF URL before connecting (AC.B.1)", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "URL validation failed: IP address 127.0.0.1 is in a private/reserved range",
    });

    const result = await fetchArticle(
      "http://127.0.0.1:8080/admin",
      15000,
      logger,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/private|validation/);
    }
  });

  it("should abort oversized response (AC.B.3)", async () => {
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "response body exceeds maxBytes (100)",
    });

    const result = await fetchArticle(
      "https://example.com/big",
      15000,
      logger,
      100,
      5,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("maxBytes");
    }
  });
});

describe("summarizeSettledResults", () => {
  it("should return all fulfilled when no rejections (AC.F.3)", () => {
    const results: PromiseSettledResult<void>[] = [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ];

    const summary = summarizeSettledResults(results);
    expect(summary.fulfilled).toBe(3);
    expect(summary.rejected).toBe(0);
    expect(summary.reasons).toEqual([]);
  });

  it("should count rejected and extract reasons (AC.F.3)", () => {
    const results: PromiseSettledResult<void>[] = [
      { status: "fulfilled", value: undefined },
      { status: "rejected", reason: new Error("DB write failed") },
      { status: "fulfilled", value: undefined },
      { status: "rejected", reason: "unexpected string rejection" },
    ];

    const summary = summarizeSettledResults(results);
    expect(summary.fulfilled).toBe(2);
    expect(summary.rejected).toBe(2);
    expect(summary.reasons).toHaveLength(2);
    expect(summary.reasons[0]).toContain("DB write failed");
    expect(summary.reasons[1]).toContain("unexpected string rejection");
  });

  it("should handle empty results array", () => {
    const summary = summarizeSettledResults([]);
    expect(summary.fulfilled).toBe(0);
    expect(summary.rejected).toBe(0);
    expect(summary.reasons).toEqual([]);
  });

  it("should safely stringify non-Error rejection reasons", () => {
    const results: PromiseSettledResult<void>[] = [
      { status: "rejected", reason: 42 },
      { status: "rejected", reason: undefined },
    ];

    const summary = summarizeSettledResults(results);
    expect(summary.rejected).toBe(2);
    expect(summary.reasons).toEqual(["42", "undefined"]);
  });
});

describe("fetchPendingArticles", () => {
  let db: AppDatabase;
  const logger = pino({ level: "silent" });
  const mockConfig: AppConfig = {
    llm: { provider: "anthropic", model: "test" },
    feeds: [],
    topics: [],
    schedule: { poll: "0 * * * *", digest: "0 0 * * *" },
    digest: { recipient: "test@example.com" },
    extraction: { maxConcurrency: 2, perDomainDelayMs: 100 },
    assessment: { maxArticleLength: 4000 },
    dedup: { similarityThreshold: 0.9, defaultLookbackDays: 15 },
    security: {
      maxResponseBytes: 10_000_000,
      maxFeedItems: 500,
      maxRedirects: 5,
    },
    shutdown: { drainTimeoutMs: 30000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDatabase();
  });

  it("should increment fetchRetryCount on failed fetch", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-1",
        url: "https://example.com/article1",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "HTTP 403: Forbidden",
    });

    await fetchPendingArticles(db, mockConfig, logger);

    const article = db.select().from(articles).get();
    expect(article?.fetchRetryCount).toBe(1);
    expect(article?.status).toBe("pending_assessment");
  });

  it("should mark article as failed when fetchRetryCount reaches MAX_RETRIES", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-2",
        url: "https://example.com/article2",
        status: "pending_assessment",
        fetchRetryCount: 2,
      })
      .run();

    vi.mocked(guardedFetch).mockResolvedValue({
      ok: false,
      error: "HTTP 403: Forbidden",
    });

    await fetchPendingArticles(db, mockConfig, logger);

    const article = db.select().from(articles).get();
    expect(article?.fetchRetryCount).toBe(3);
    expect(article?.status).toBe("failed");
  });

  it("should skip articles with fetchRetryCount >= MAX_RETRIES", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-3",
        url: "https://example.com/article3",
        status: "pending_assessment",
        fetchRetryCount: 3,
      })
      .run();

    vi.mocked(guardedFetch);

    await fetchPendingArticles(db, mockConfig, logger);

    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("should store raw HTML on successful fetch", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-4",
        url: "https://example.com/article4",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    const htmlContent = "<html><body>Article body</body></html>";
    vi.mocked(guardedFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: htmlContent,
      finalUrl: "https://example.com/article4",
    });

    await fetchPendingArticles(db, mockConfig, logger);

    const article = db.select().from(articles).get();
    expect(article?.rawHtml).toBe(htmlContent);
    expect(article?.fetchedAt).not.toBeNull();
  });

  it("should not fetch articles that already have rawHtml set", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-5",
        url: "https://example.com/article5",
        status: "pending_assessment",
        fetchRetryCount: 0,
        rawHtml: "<html>Already fetched</html>",
      })
      .run();

    vi.mocked(guardedFetch);

    await fetchPendingArticles(db, mockConfig, logger);

    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("should skip articles with status other than pending_assessment", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-6",
        url: "https://example.com/article6",
        status: "assessed",
        fetchRetryCount: 0,
      })
      .run();

    vi.mocked(guardedFetch);

    await fetchPendingArticles(db, mockConfig, logger);

    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("should mark article as failed when URL is malformed (AC.F.1, AC.F.2)", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "malformed-url-article",
        url: "not-a-valid-url",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    await fetchPendingArticles(db, mockConfig, logger);

    const article = db.select().from(articles).get();
    expect(article?.status).toBe("failed");
    expect(article?.fetchRetryCount).toBe(3); // MAX_RETRIES
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("should mark article as failed when URL is empty string (AC.F.1)", async () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "empty-url-article",
        url: "",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    await fetchPendingArticles(db, mockConfig, logger);

    const article = db.select().from(articles).get();
    expect(article?.status).toBe("failed");
    expect(article?.fetchRetryCount).toBe(3);
  });

  it("should process valid articles even when batch contains malformed URLs (AC.F.4)", async () => {
    const feedId = seedTestFeed(db);

    // Article with malformed URL
    db.insert(articles)
      .values({
        feedId,
        guid: "malformed-in-batch",
        url: "://broken-url",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    // Article with valid URL
    db.insert(articles)
      .values({
        feedId,
        guid: "valid-in-batch",
        url: "https://example.com/valid-article",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    vi.mocked(guardedFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: "<html><body>Valid content</body></html>",
      finalUrl: "https://example.com/valid-article",
    });

    await fetchPendingArticles(db, mockConfig, logger);

    const allArticles = db.select().from(articles).all();
    const malformed = allArticles.find((a) => a.guid === "malformed-in-batch");
    const valid = allArticles.find((a) => a.guid === "valid-in-batch");

    // Malformed article failed
    expect(malformed?.status).toBe("failed");
    expect(malformed?.fetchRetryCount).toBe(3);

    // Valid article fetched successfully
    expect(valid?.status).toBe("pending_assessment");
    expect(valid?.rawHtml).toBe("<html><body>Valid content</body></html>");
    expect(valid?.fetchRetryCount).toBe(0);
  });

  it("should log structured warning for malformed URL (AC.F.1)", async () => {
    const feedId = seedTestFeed(db);
    const { logger: captureLogger, getMessages } = createTestLoggerWithCapture("warn");

    db.insert(articles)
      .values({
        feedId,
        guid: "warn-test-article",
        url: "ftp://[broken",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    await fetchPendingArticles(db, mockConfig, captureLogger);

    const messages = getMessages();
    const warning = messages.find(
      (m) => m.message === "article has malformed URL — marking as failed",
    );
    expect(warning).toBeDefined();
    expect(warning?.level).toBe("warn");
  });

  it("should not log rejection warning when all tasks fulfill (AC.F.3)", async () => {
    const feedId = seedTestFeed(db);
    const { logger: captureLogger, getMessages } = createTestLoggerWithCapture();

    db.insert(articles)
      .values({
        feedId,
        guid: "clean-article",
        url: "https://example.com/clean",
        status: "pending_assessment",
        fetchRetryCount: 0,
      })
      .run();

    vi.mocked(guardedFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: "<html>Clean</html>",
      finalUrl: "https://example.com/clean",
    });

    await fetchPendingArticles(db, mockConfig, captureLogger);

    const messages = getMessages();
    const warning = messages.find(
      (m) => m.level === "warn" && m.message.includes("rejected"),
    );
    expect(warning).toBeUndefined();

    const summary = messages.find((m) => m.message === "article fetch cycle complete");
    expect(summary).toBeDefined();
  });
});
