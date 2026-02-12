import { describe, it, expect } from "vitest";
import { createTestDatabase, seedTestFeed } from "./db";

describe("Test Database Utilities", () => {
  it("should create an in-memory database", () => {
    const db = createTestDatabase();
    expect(db).toBeDefined();
  });

  it("should seed a test feed", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db);
    expect(feedId).toBeGreaterThan(0);
  });

  it("should seed a test feed with overrides", () => {
    const db = createTestDatabase();
    const feedId = seedTestFeed(db, {
      name: "Custom Feed",
      url: "https://custom.example.com/rss",
    });
    expect(feedId).toBeGreaterThan(0);
  });
});
