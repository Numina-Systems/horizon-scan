import { describe, it, expect } from "vitest";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestTopic,
  seedTestArticle,
} from "../test-utils/db";
import { assessments } from "./schema";

describe("assessments unique index migration (AC.C.3)", () => {
  it("should reject duplicate (articleId, topicId) assessments at the DB level after migration", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);
    const topicId = seedTestTopic(db);
    const articleId = seedTestArticle(db, feedId);

    // First insert succeeds
    db.insert(assessments)
      .values({
        articleId,
        topicId,
        relevant: true,
        summary: "First",
        tags: [],
        modelUsed: "test",
        provider: "test",
        assessedAt: new Date(),
      })
      .run();

    // Duplicate insert (same articleId + topicId) throws — unique index is enforced
    expect(() => {
      db.insert(assessments)
        .values({
          articleId,
          topicId,
          relevant: false,
          summary: "Duplicate",
          tags: [],
          modelUsed: "test",
          provider: "test",
          assessedAt: new Date(),
        })
        .run();
    }).toThrow();
  });
});
