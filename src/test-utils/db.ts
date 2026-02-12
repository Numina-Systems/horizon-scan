import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../db";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { feeds, articles, topics, assessments } from "../db/schema";
import { createCallerFactory } from "../api/trpc";
import { appRouter } from "../api/router";
import pino from "pino";

/**
 * Creates an in-memory SQLite test database with all migrations applied.
 * @returns A new AppDatabase instance with schema initialized.
 */
export function createTestDatabase(): AppDatabase {
  const { db } = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

/**
 * Seeds a test feed into the database with optional field overrides.
 * @param db - The AppDatabase instance to seed into.
 * @param overrides - Optional Partial<Feeds> to override default test feed values.
 * @returns The ID of the inserted feed.
 */
export function seedTestFeed(
  db: AppDatabase,
  overrides?: Partial<typeof feeds.$inferInsert>,
): number {
  const result = db
    .insert(feeds)
    .values({
      name: "Test Feed",
      url: "https://example.com/rss",
      extractorConfig: {
        bodySelector: "article",
        jsonLd: true,
      },
      ...overrides,
    })
    .returning({ id: feeds.id })
    .get();

  return result.id;
}

/**
 * Seeds a test article into the database with optional field overrides.
 * @param db - The AppDatabase instance to seed into.
 * @param feedId - The feed ID to associate with the article.
 * @param overrides - Optional Partial to override default test article values.
 * @returns The ID of the inserted article.
 */
export function seedTestArticle(
  db: AppDatabase,
  feedId: number,
  overrides?: Partial<typeof articles.$inferInsert>,
): number {
  const result = db
    .insert(articles)
    .values({
      feedId,
      guid: `guid-${Date.now()}-${Math.random()}`,
      title: "Test Article",
      url: "https://example.com/article",
      status: "pending_assessment",
      ...overrides,
    })
    .returning({ id: articles.id })
    .get();

  return result.id;
}

/**
 * Seeds a test topic into the database with optional field overrides.
 * @param db - The AppDatabase instance to seed into.
 * @param overrides - Optional Partial to override default test topic values.
 * @returns The ID of the inserted topic.
 */
export function seedTestTopic(
  db: AppDatabase,
  overrides?: Partial<typeof topics.$inferInsert>,
): number {
  const result = db
    .insert(topics)
    .values({
      name: "Test Topic",
      description: "A test topic",
      ...overrides,
    })
    .returning({ id: topics.id })
    .get();

  return result.id;
}

/**
 * Seeds a test assessment into the database with optional field overrides.
 * @param db - The AppDatabase instance to seed into.
 * @param articleId - The article ID to assess.
 * @param topicId - The topic ID for the assessment.
 * @param overrides - Optional Partial to override default test assessment values.
 * @returns The ID of the inserted assessment.
 */
export function seedTestAssessment(
  db: AppDatabase,
  articleId: number,
  topicId: number,
  overrides?: Partial<typeof assessments.$inferInsert>,
): number {
  const result = db
    .insert(assessments)
    .values({
      articleId,
      topicId,
      relevant: false,
      tags: [],
      modelUsed: "test-model",
      provider: "test-provider",
      assessedAt: new Date(),
      ...overrides,
    })
    .returning({ id: assessments.id })
    .get();

  return result.id;
}

/**
 * Creates a default AppConfig suitable for testing.
 * @returns An AppConfig instance with all required fields.
 */
export function createTestConfig(): AppConfig {
  return {
    llm: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    feeds: [
      {
        name: "Example Feed",
        url: "https://example.com/rss",
        extractorConfig: {
          bodySelector: "article",
          jsonLd: true,
        },
        pollIntervalMinutes: 15,
        enabled: true,
      },
    ],
    topics: [
      {
        name: "Technology",
        description: "Technology news",
        enabled: true,
      },
    ],
    schedule: {
      poll: "*/15 * * * *",
      digest: "0 9 * * *",
    },
    digest: {
      recipient: "test@example.com",
    },
    extraction: {
      maxConcurrency: 2,
      perDomainDelayMs: 1000,
    },
    assessment: {
      maxArticleLength: 4000,
    },
  };
}

/**
 * Creates a fully-typed tRPC caller for testing router procedures directly.
 * Accepts optional config overrides for custom test scenarios.
 * @param db - The AppDatabase instance to use.
 * @param configOverrides - Optional partial AppConfig to override defaults.
 * @returns A typed caller function that can invoke router procedures.
 */
export function createTestCaller(
  db: AppDatabase,
  configOverrides?: Partial<AppConfig>,
) {
  const createCaller = createCallerFactory(appRouter);
  const config = { ...createTestConfig(), ...configOverrides };
  const logger = pino({ level: "silent" });

  return createCaller({ db, config, logger });
}
