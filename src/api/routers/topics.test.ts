import { describe, it, expect, beforeEach } from "vitest";
import { createCallerFactory } from "../trpc";
import pino from "pino";
import { appRouter } from "../router";
import {
  createTestDatabase,
  seedTestTopic,
  createTestConfig,
} from "../../test-utils/db";
import type { AppDatabase } from "../../db";
import type { AppContext } from "../context";

describe("topics router", () => {
  let db: AppDatabase;
  let caller: any;
  const config = createTestConfig();
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    db = createTestDatabase();
    const createCaller = createCallerFactory(appRouter);
    const context: AppContext = { db, config, logger };
    caller = createCaller(context);
  });

  it("should return empty list initially", async () => {
    const result = await caller.topics.list();
    expect(result).toEqual([]);
  });

  it("should create a topic and return it (AC5.2)", async () => {
    const created = await caller.topics.create({
      name: "AI",
      description: "Artificial Intelligence",
      enabled: true,
    });

    expect(created).toMatchObject({
      name: "AI",
      description: "Artificial Intelligence",
      enabled: true,
    });
    expect(created.id).toBeDefined();
  });

  it("should list topics after creation (AC5.2)", async () => {
    seedTestTopic(db, {
      name: "Topic 1",
      description: "First topic",
    });
    seedTestTopic(db, {
      name: "Topic 2",
      description: "Second topic",
    });

    const result = await caller.topics.list();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "Topic 1" });
    expect(result[1]).toMatchObject({ name: "Topic 2" });
  });

  it("should get topic by ID (AC5.2)", async () => {
    const topicId = seedTestTopic(db, { name: "Specific Topic" });

    const result = await caller.topics.getById({ id: topicId });
    expect(result).toMatchObject({
      id: topicId,
      name: "Specific Topic",
    });
  });

  it("should return null for non-existent topic ID (AC5.2)", async () => {
    const result = await caller.topics.getById({ id: 9999 });
    expect(result).toBeUndefined();
  });

  it("should update a topic (AC5.2)", async () => {
    const topicId = seedTestTopic(db, {
      name: "Original",
      description: "Original description",
    });

    const updated = await caller.topics.update({
      id: topicId,
      name: "Updated",
      description: "Updated description",
      enabled: false,
    });

    expect(updated).toMatchObject({
      id: topicId,
      name: "Updated",
      description: "Updated description",
      enabled: false,
    });

    const fetched = await caller.topics.getById({ id: topicId });
    expect(fetched?.name).toBe("Updated");
  });

  it("should delete a topic (AC5.2)", async () => {
    const topicId = seedTestTopic(db, { name: "To Delete" });

    const result = await caller.topics.delete({ id: topicId });
    expect(result).toEqual({ success: true });

    const fetched = await caller.topics.getById({ id: topicId });
    expect(fetched).toBeUndefined();

    const list = await caller.topics.list();
    expect(list).toHaveLength(0);
  });
});
