import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../db";
import type { AppDatabase } from "../db";
import { feeds } from "../db/schema";

/**
 * Creates an in-memory SQLite test database with all migrations applied.
 * @returns A new AppDatabase instance with schema initialized.
 */
export function createTestDatabase(): AppDatabase {
  const db = createDatabase(":memory:");
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
