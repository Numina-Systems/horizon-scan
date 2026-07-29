import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { fetchArticle, fetchPendingArticles } from "./fetcher";
import { guardedFetch } from "../security/fetch-guard";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
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
});
