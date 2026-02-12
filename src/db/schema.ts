import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------- JSON column types ----------

export type ExtractorConfig = {
  readonly bodySelector: string;
  readonly jsonLd: boolean;
  readonly metadataSelectors?: Readonly<Record<string, string>>;
};

// ---------- Tables ----------

export const feeds = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  extractorConfig: text("extractor_config", { mode: "json" })
    .$type<ExtractorConfig>()
    .notNull(),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(15),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastPolledAt: integer("last_polled_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    guid: text("guid").notNull().unique(),
    title: text("title"),
    url: text("url").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    rawHtml: text("raw_html"),
    extractedText: text("extracted_text"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", {
      enum: ["pending_assessment", "assessed", "failed"],
    })
      .notNull()
      .default("pending_assessment"),
    fetchRetryCount: integer("fetch_retry_count").notNull().default(0),
    assessmentRetryCount: integer("assessment_retry_count").notNull().default(0),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    feedIdIdx: index("articles_feed_id_idx").on(table.feedId),
    statusIdx: index("articles_status_idx").on(table.status),
  }),
);

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const assessments = sqliteTable(
  "assessments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id),
    relevant: integer("relevant", { mode: "boolean" }).notNull(),
    summary: text("summary"),
    tags: text("tags", { mode: "json" }).$type<Array<string>>().notNull(),
    modelUsed: text("model_used").notNull(),
    provider: text("provider").notNull(),
    assessedAt: integer("assessed_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    articleIdIdx: index("assessments_article_id_idx").on(table.articleId),
    topicIdIdx: index("assessments_topic_id_idx").on(table.topicId),
  }),
);

export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
  articleCount: integer("article_count").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["success", "failed"] }).notNull(),
});
