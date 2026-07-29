// pattern: imperative-shell
import { eq, and, lt, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import pLimit from "p-limit";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles } from "../db/schema";
import { guardedFetch } from "../security/fetch-guard";

export type FetchResult =
  | { success: true; html: string; url: string }
  | { success: false; error: string; url: string };

/**
 * Fetches article HTML from a single URL with timeout support.
 * Returns structured result indicating success or failure with error details.
 */
export async function fetchArticle(
  url: string,
  timeoutMs: number,
  logger: Logger,
  maxResponseBytes: number = 10_000_000,
  maxRedirects: number = 5,
): Promise<FetchResult> {
  try {
    const result = await guardedFetch(url, {
      maxBytes: maxResponseBytes,
      maxRedirects,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "HorizonScan/1.0 (RSS article fetcher)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        url,
      };
    }

    return { success: true, html: result.body, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, error: message }, "article fetch failed");
    return { success: false, error: message, url };
  }
}

const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Summarises the results of `Promise.allSettled` for logging purposes.
 * Pure function — no side effects, directly unit-testable.
 */
export function summarizeSettledResults(
  results: PromiseSettledResult<void>[],
): { fulfilled: number; rejected: number; reasons: string[] } {
  const reasons: string[] = [];
  let rejected = 0;

  for (const r of results) {
    if (r.status === "rejected") {
      rejected++;
      reasons.push(String(r.reason));
    }
  }

  return { fulfilled: results.length - rejected, rejected, reasons };
}

/**
 * Fetches pending articles from the database with concurrency limiting and per-domain delay.
 * Updates articles with raw HTML on success or increments retry count on failure.
 * Articles exceeding MAX_RETRIES are marked as failed.
 */
export async function fetchPendingArticles(
  db: AppDatabase,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const pending = db
    .select({
      id: articles.id,
      url: articles.url,
      feedId: articles.feedId,
      fetchRetryCount: articles.fetchRetryCount,
    })
    .from(articles)
    .where(
      and(
        eq(articles.status, "pending_assessment"),
        isNull(articles.rawHtml),
        lt(articles.fetchRetryCount, MAX_RETRIES),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending fetch");
    return;
  }

  const limit = pLimit(config.extraction.maxConcurrency);
  const delayMs = config.extraction.perDomainDelayMs;

  const domainLastFetch = new Map<string, number>();

  const tasks = pending.map((article) =>
    limit(async () => {
      // Parse URL for domain-based delay. A malformed URL is a terminal failure —
      // retrying will never fix a syntactically invalid URL.
      let domain: string;
      try {
        domain = new URL(article.url).hostname;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          { articleId: article.id, url: article.url, error: message },
          "article has malformed URL — marking as failed",
        );
        db.update(articles)
          .set({ status: "failed", fetchRetryCount: MAX_RETRIES })
          .where(eq(articles.id, article.id))
          .run();
        return;
      }

      const lastFetch = domainLastFetch.get(domain) ?? 0;
      const elapsed = Date.now() - lastFetch;

      if (elapsed < delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs - elapsed),
        );
      }

      domainLastFetch.set(domain, Date.now());

      const result = await fetchArticle(
        article.url,
        FETCH_TIMEOUT_MS,
        logger,
        config.security.maxResponseBytes,
        config.security.maxRedirects,
      );

      if (result.success) {
        db.update(articles)
          .set({
            rawHtml: result.html,
            fetchedAt: new Date(),
          })
          .where(eq(articles.id, article.id))
          .run();
      } else {
        const newRetryCount = article.fetchRetryCount + 1;
        db.update(articles)
          .set({
            fetchRetryCount: newRetryCount,
            status: newRetryCount >= MAX_RETRIES ? "failed" : "pending_assessment",
          })
          .where(eq(articles.id, article.id))
          .run();
      }
    }),
  );

  const results = await Promise.allSettled(tasks);
  const summary = summarizeSettledResults(results);

  if (summary.rejected > 0) {
    logger.warn(
      {
        total: pending.length,
        fulfilled: summary.fulfilled,
        rejected: summary.rejected,
        rejectionReasons: summary.reasons,
      },
      "some article fetch tasks were rejected — these may need investigation",
    );
  }

  logger.info(
    { total: pending.length, fulfilled: summary.fulfilled, rejected: summary.rejected },
    "article fetch cycle complete",
  );
}
