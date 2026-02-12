import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../db";
import type { AppDatabase } from "../db";
import { feeds } from "../db/schema";

export function createTestDatabase(): AppDatabase {
  const db = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

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
