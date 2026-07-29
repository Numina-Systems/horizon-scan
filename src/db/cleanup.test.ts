import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { cleanupDuplicateAssessments } from "./index";

function createTestSqlite(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function createAssessmentsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      topic_id INTEGER NOT NULL,
      relevant INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      tags TEXT,
      embedding BLOB
    );
  `);
}

function insertAssessment(
  db: Database.Database,
  articleId: number,
  topicId: number,
): void {
  db.prepare(
    "INSERT INTO assessments (article_id, topic_id, relevant, summary, tags) VALUES (?, ?, 0, ?, '[]')",
  ).run(articleId, topicId, `assessment for ${articleId}/${topicId}`);
}

describe("cleanupDuplicateAssessments", () => {
  it("should return 0 when assessments table does not exist", () => {
    const db = createTestSqlite();
    // Don't create the assessments table
    const result = cleanupDuplicateAssessments(db);
    expect(result).toBe(0);
    db.close();
  });

  it("should remove duplicates and keep the lowest-id row per (article_id, topic_id)", () => {
    const db = createTestSqlite();
    createAssessmentsTable(db);

    // Insert two duplicate pairs and one unique
    insertAssessment(db, 1, 10); // id=1 (keep)
    insertAssessment(db, 1, 10); // id=2 (remove)
    insertAssessment(db, 2, 20); // id=3 (keep)
    insertAssessment(db, 2, 20); // id=4 (remove)
    insertAssessment(db, 3, 30); // id=5 (unique, keep)

    const removed = cleanupDuplicateAssessments(db);
    expect(removed).toBe(2);

    const remaining = db
      .prepare("SELECT id, article_id, topic_id FROM assessments ORDER BY id")
      .all() as Array<{ id: number; article_id: number; topic_id: number }>;
    expect(remaining).toHaveLength(3);
    expect(remaining[0]!.id).toBe(1);
    expect(remaining[1]!.id).toBe(3);
    expect(remaining[2]!.id).toBe(5);

    db.close();
  });

  it("should be a no-op returning 0 when no duplicates exist", () => {
    const db = createTestSqlite();
    createAssessmentsTable(db);

    insertAssessment(db, 1, 10);
    insertAssessment(db, 2, 20);

    const removed = cleanupDuplicateAssessments(db);
    expect(removed).toBe(0);

    const count = db.prepare("SELECT COUNT(*) as count FROM assessments").get() as { count: number };
    expect(count.count).toBe(2);

    db.close();
  });

  it("should remove multiple distinct duplicate pairs in one pass", () => {
    const db = createTestSqlite();
    createAssessmentsTable(db);

    // 3 duplicates of (1,10), 2 duplicates of (2,20), 1 unique (3,30)
    insertAssessment(db, 1, 10); // keep
    insertAssessment(db, 1, 10); // remove
    insertAssessment(db, 1, 10); // remove
    insertAssessment(db, 2, 20); // keep
    insertAssessment(db, 2, 20); // remove
    insertAssessment(db, 3, 30); // unique

    const removed = cleanupDuplicateAssessments(db);
    expect(removed).toBe(3);

    const remaining = db
      .prepare("SELECT article_id, topic_id FROM assessments ORDER BY id")
      .all() as Array<{ article_id: number; topic_id: number }>;
    expect(remaining).toHaveLength(3);

    db.close();
  });
});
