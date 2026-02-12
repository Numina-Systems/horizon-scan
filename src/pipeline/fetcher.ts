import { eq, and, lt, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import pLimit from "p-limit";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles } from "../db/schema";

type FetchResult =
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
): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "HorizonScan/1.0 (RSS article fetcher)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        url,
      };
    }

    const html = await response.text();
    return { success: true, html, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, error: message }, "article fetch failed");
    return { success: false, error: message, url };
  }
}

const MAX_RETRIES = 3;

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
      const domain = new URL(article.url).hostname;
      const lastFetch = domainLastFetch.get(domain) ?? 0;
      const elapsed = Date.now() - lastFetch;

      if (elapsed < delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs - elapsed),
        );
      }

      domainLastFetch.set(domain, Date.now());

      const result = await fetchArticle(article.url, 15000, logger);

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

  await Promise.allSettled(tasks);
  logger.info({ totalFetched: pending.length }, "article fetch cycle complete");
}
