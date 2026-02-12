import { eq, and, isNull, isNotNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import { articles, feeds } from "../db/schema";
import { extractContent } from "./extractor";

/**
 * Extracts pending articles' content from their raw HTML using feed-specific
 * extractor configurations. Merges JSON-LD data into article metadata.
 *
 * @param db - The application database instance.
 * @param logger - Logger instance for debug and error messages.
 */
export function extractPendingArticles(
  db: AppDatabase,
  logger: Logger,
): void {
  const pending = db
    .select({
      articleId: articles.id,
      rawHtml: articles.rawHtml,
      articleMetadata: articles.metadata,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(
      and(
        isNotNull(articles.rawHtml),
        isNull(articles.extractedText),
        eq(articles.status, "pending_assessment"),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending extraction");
    return;
  }

  for (const row of pending) {
    try {
      const feed = db
        .select({ extractorConfig: feeds.extractorConfig })
        .from(feeds)
        .where(eq(feeds.id, row.feedId))
        .get();

      if (!feed) {
        logger.warn({ articleId: row.articleId }, "feed not found for article");
        continue;
      }

      const result = extractContent(
        row.rawHtml as string,
        feed.extractorConfig,
        logger,
      );

      // Merge JSON-LD data with existing RSS metadata
      const existingMetadata =
        (row.articleMetadata as Record<string, unknown>) ?? {};
      const mergedMetadata = {
        ...existingMetadata,
        jsonLd: result.jsonLdData,
      };

      db.update(articles)
        .set({
          extractedText: result.extractedText,
          metadata: mergedMetadata,
        })
        .where(eq(articles.id, row.articleId))
        .run();

      logger.debug(
        { articleId: row.articleId, textLength: result.extractedText.length },
        "article extracted",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { articleId: row.articleId, error: message },
        "extraction failed for article",
      );
    }
  }

  logger.info({ count: pending.length }, "extraction cycle complete");
}
