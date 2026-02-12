// pattern: Imperative Shell
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDatabase(
  dbPath: string,
): { readonly db: AppDatabase; readonly close: () => void } {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return { db, close: () => sqlite.close() };
}

export type DatabaseResult = ReturnType<typeof createDatabase>;
export type AppDatabase = BetterSQLite3Database<typeof schema>;
