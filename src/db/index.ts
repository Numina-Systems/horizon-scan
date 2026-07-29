// pattern: Imperative Shell
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Pre-migration safety check: remove duplicate (article_id, topic_id) pairs
 * from the assessments table before the unique index migration runs.
 *
 * Uses the raw better-sqlite3 handle (not Drizzle) because the assessments
 * table schema predates Drizzle wrapping. Returns the number of rows removed.
 *
 * Becomes a no-op once the unique index is in place.
 */
export function cleanupDuplicateAssessments(
  sqlite: Database.Database,
): number {
  // Check if the assessments table exists (it won't on a fresh database)
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='assessments'",
    )
    .get() as { name: string } | undefined;

  if (!table) return 0;

  // Delete duplicates, keeping the lowest-id row per (article_id, topic_id) pair
  const result = sqlite
    .prepare(
      `DELETE FROM assessments WHERE id NOT IN (
         SELECT MIN(id) FROM assessments GROUP BY article_id, topic_id
       )`,
    )
    .run();

  return result.changes;
}

export function createDatabase(
  dbPath: string,
): { readonly db: AppDatabase; readonly sqlite: Database.Database; readonly close: () => void } {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return { db, sqlite, close: () => sqlite.close() };
}

export type DatabaseResult = ReturnType<typeof createDatabase>;
export type AppDatabase = BetterSQLite3Database<typeof schema>;
