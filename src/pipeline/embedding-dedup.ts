// pattern: imperative-shell
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { EmbeddingModel } from "ai";
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles, feeds } from "../db/schema";
import { generateEmbedding, prepareEmbeddingInput, cosineSimilarity } from "../embedding";
import type { EmbeddingDedupResult } from "./types";

const MAX_EMBEDDING_RETRIES = 3;
const EXPECTED_EMBEDDING_DIM = 768;

/**
 * Processes pending articles for embedding-based deduplication.
 * Generates embeddings, compares against recent articles within lookback window,
 * and marks articles as duplicate (similarity >= threshold) or pending_assessment.
 *
 * @param db - The application database instance.
 * @param embeddingModel - The embedding model to use for generating embeddings.
 * @param config - Application configuration with dedup settings.
 * @param logger - Logger instance for debug and error messages.
 * @returns Result summary with counts of processed, duplicate, passed, and failed articles.
 */
export async function processPendingDedup(
  db: AppDatabase,
  embeddingModel: EmbeddingModel, // EmbeddingModel is a union type in ai v4+ (not generic)
  config: AppConfig,
  logger: Logger,
): Promise<EmbeddingDedupResult> {
  let processedCount = 0;
  let duplicateCount = 0;
  let passedCount = 0;
  let failedCount = 0;

  const pending = db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      title: articles.title,
      extractedText: articles.extractedText,
    })
    .from(articles)
    .where(
      and(
        eq(articles.status, "pending_dedup"),
        lt(articles.embeddingRetryCount, MAX_EMBEDDING_RETRIES),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending embedding dedup");
  } else {
    for (const article of pending) {
    try {
      // Prepare text for embedding
      const text = prepareEmbeddingInput({
        title: article.title,
        body: article.extractedText,
      });

      // Skip embedding generation if text is empty, transition directly to pending_assessment
      if (!text.trim()) {
        db.update(articles)
          .set({
            status: "pending_assessment",
          })
          .where(eq(articles.id, article.id))
          .run();

        processedCount++;
        passedCount++;
        continue;
      }

      // Generate embedding for the article
      const embedding = await generateEmbedding(embeddingModel, text);

      // Validate embedding dimension
      if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
        logger.warn(
          { articleId: article.id, actual: embedding.length, expected: EXPECTED_EMBEDDING_DIM },
          "embedding dimension mismatch, retrying",
        );
        db.update(articles)
          .set({ embeddingRetryCount: sql`embedding_retry_count + 1` })
          .where(eq(articles.id, article.id))
          .run();
        failedCount++;
        continue;
      }

      // Determine lookback window: use per-feed override if set, otherwise default
      const feedConfig = db
        .select({ dedupLookbackDays: feeds.dedupLookbackDays })
        .from(feeds)
        .where(eq(feeds.id, article.feedId))
        .get();

      const lookbackDays = feedConfig?.dedupLookbackDays ?? config.dedup.defaultLookbackDays;
      const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

      // Load recent articles with embeddings within lookback window
      const recentArticles = db
        .select({ id: articles.id, embedding: articles.embedding })
        .from(articles)
        .where(
          and(
            isNotNull(articles.embedding),
            gte(articles.createdAt, cutoff),
          ),
        )
        .all();

      // Find maximum similarity
      let maxSimilarity = 0;
      for (const recent of recentArticles) {
        if (recent.embedding) {
          const similarity = cosineSimilarity(
            embedding as number[],
            Array.from(recent.embedding),
          );
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
      }

      // Determine if duplicate or passed
      const isDuplicate = maxSimilarity >= config.dedup.similarityThreshold;
      const newStatus = isDuplicate ? "duplicate" : "pending_assessment";

      // Update atomically: both embedding and status
      db.update(articles)
        .set({
          embedding: Array.from(embedding),
          status: newStatus,
        })
        .where(eq(articles.id, article.id))
        .run();

      processedCount++;
      if (isDuplicate) {
        duplicateCount++;
      } else {
        passedCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ articleId: article.id, error: message }, "failed to process article for embedding dedup");
      db.update(articles)
        .set({ embeddingRetryCount: sql`embedding_retry_count + 1` })
        .where(eq(articles.id, article.id))
        .run();
      failedCount++;
      // Leave article in pending_dedup for retry on next cycle
    }
  }
  }

  // Fallback: transition articles that have exceeded max retries to pending_assessment
  const fallbackResult = db
    .update(articles)
    .set({ status: "pending_assessment" })
    .where(
      and(
        eq(articles.status, "pending_dedup"),
        gte(articles.embeddingRetryCount, MAX_EMBEDDING_RETRIES),
      ),
    )
    .run();

  if (fallbackResult.changes > 0) {
    logger.info(
      { count: fallbackResult.changes },
      "fallback: transitioned pending_dedup articles exceeding max retries to pending_assessment",
    );
    passedCount += fallbackResult.changes;
    processedCount += fallbackResult.changes;
  }

  logger.info(
    { processedCount, duplicateCount, passedCount, failedCount },
    "embedding dedup cycle complete",
  );

  return {
    processedCount,
    duplicateCount,
    passedCount,
    failedCount,
  };
}

/**
 * Fallback function to transition pending_dedup articles directly to pending_assessment
 * when the embedding model is unavailable. Used when embedding model is null at startup.
 *
 * @param db - The application database instance.
 * @param logger - Logger instance for info messages.
 */
export function fallbackPendingDedup(db: AppDatabase, logger: Logger): void {
  const result = db
    .update(articles)
    .set({ status: "pending_assessment" })
    .where(eq(articles.status, "pending_dedup"))
    .run();

  if (result.changes > 0) {
    logger.info(
      { count: result.changes },
      "fallback: transitioned pending_dedup articles to pending_assessment (no embedding model)",
    );
  }
}
