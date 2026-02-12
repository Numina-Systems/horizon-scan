import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { articles } from "../db/schema";
import type { AppDatabase } from "../db";
import type { ParsedRssItem, DedupResult } from "./types";

export function deduplicateAndStore(
  db: AppDatabase,
  feedId: number,
  feedName: string,
  items: ReadonlyArray<ParsedRssItem>,
  logger: Logger,
): DedupResult {
  let newCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const existing = db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.guid, item.guid))
      .get();

    if (existing) {
      skippedCount++;
      continue;
    }

    db.insert(articles)
      .values({
        feedId,
        guid: item.guid,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        metadata: item.metadata,
        status: "pending_assessment",
      })
      .run();

    newCount++;
  }

  logger.info({ feedName, newCount, skippedCount }, "dedup complete");
  return { feedName, newCount, skippedCount };
}
