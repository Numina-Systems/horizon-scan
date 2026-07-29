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

  // Per-domain promise chain for serializing same-origin fetch starts (AC.G.1).
  // Each entry is the normalized "tail" for a hostname: resolves when the most
  // recent task for that domain completed. A new task for the same domain waits
  // for this tail plus perDomainDelayMs before starting, ensuring starts are
  // separated by at least perDomainDelayMs.
  const domainQueues = new Map<string, Promise<void>>();

  /**
   * Enqueues a task onto a domain's serialization chain. The task runs only
   * after the previous same-domain task completed AND perDomainDelayMs elapsed.
   *
   * The limit() call is INSIDE the task so domain-tail waiting does not consume
   * a global concurrency slot (AC.G.2).
   *
   * Error safety (AC.G.3): both the prior tail and the task result are
   * normalized with catch handlers so a rejection never poisons the chain.
   */
  function enqueueDomain(
    domain: string,
    task: () => Promise<void>,
    domainDelayMs: number,
  ): Promise<void> {
    const prev = domainQueues.get(domain) ?? Promise.resolve();
    // Wait for previous same-domain task + delay, THEN run task
    const runAfterDelay = prev.then(() =>
      new Promise<void>((resolve) => setTimeout(resolve, domainDelayMs)),
    );
    const taskResult = runAfterDelay.then(() => task());
    // Store normalized tail (never rejects, so next item in chain isn't poisoned)
    domainQueues.set(domain, taskResult.then(() => {}, () => {}));
    return taskResult;
  }

  const tasks = pending.map((article) => {
    // Parse URL for domain-based scheduling. A malformed URL is a terminal
    // failure — retrying will never fix a syntactically invalid URL.
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
      return Promise.resolve();
    }

    // limit() is INSIDE the domain chain so domain-tail waiting doesn't
    // consume a global concurrency slot (AC.G.2).
    return enqueueDomain(
      domain,
      () =>
        limit(async () => {
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
                status:
                  newRetryCount >= MAX_RETRIES
                    ? "failed"
                    : "pending_assessment",
              })
              .where(eq(articles.id, article.id))
              .run();
          }
        }),
      delayMs,
    );
  });

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
