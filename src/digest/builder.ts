import { eq, and, gt, desc } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { assessments, articles, topics, digests } from "../db/schema";

// pattern: Imperative Shell

/**
 * An article included in a digest, extracted from an assessment.
 */
export type DigestArticle = Readonly<{
  title: string | null;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
  tags: ReadonlyArray<string>;
}>;

/**
 * A group of articles grouped by topic for digest rendering.
 */
export type DigestTopicGroup = Readonly<{
  topicName: string;
  articles: ReadonlyArray<DigestArticle>;
}>;

/**
 * Complete structured data for a digest email, ready to be rendered.
 */
export type DigestData = Readonly<{
  topicGroups: ReadonlyArray<DigestTopicGroup>;
  totalArticleCount: number;
}>;

/**
 * Builds a digest by querying all relevant assessments since the last successful digest,
 * joining with articles and topics, and grouping by topic name.
 *
 * @param db - The application database connection
 * @returns Structured digest data including grouped articles and total count. Returns empty
 *          topicGroups if no relevant articles exist in the current window (AC3.4 — caller
 *          decides whether to send).
 */
export function buildDigest(db: AppDatabase): DigestData {
  // Find the last successful digest timestamp
  const lastDigest = db
    .select({ sentAt: digests.sentAt })
    .from(digests)
    .where(eq(digests.status, "success"))
    .orderBy(desc(digests.sentAt))
    .limit(1)
    .get();

  const sinceDate = lastDigest?.sentAt ?? new Date(0);

  // Query relevant assessments since last digest, joined with articles and topics
  const rows = db
    .select({
      topicName: topics.name,
      articleTitle: articles.title,
      articleUrl: articles.url,
      articlePublishedAt: articles.publishedAt,
      summary: assessments.summary,
      tags: assessments.tags,
    })
    .from(assessments)
    .innerJoin(articles, eq(assessments.articleId, articles.id))
    .innerJoin(topics, eq(assessments.topicId, topics.id))
    .where(
      and(
        eq(assessments.relevant, true),
        gt(assessments.assessedAt, sinceDate),
      ),
    )
    .all();

  // Group by topic
  const groupMap = new Map<string, Array<DigestArticle>>();

  for (const row of rows) {
    const group = groupMap.get(row.topicName) ?? [];
    group.push({
      title: row.articleTitle,
      url: row.articleUrl,
      publishedAt: row.articlePublishedAt,
      summary: row.summary,
      tags: row.tags,
    });
    groupMap.set(row.topicName, group);
  }

  const topicGroups: Array<DigestTopicGroup> = Array.from(
    groupMap.entries(),
  ).map(([topicName, articles]) => ({ topicName, articles }));

  return {
    topicGroups,
    totalArticleCount: rows.length,
  };
}
