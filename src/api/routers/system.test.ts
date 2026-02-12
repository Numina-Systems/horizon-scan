import { describe, it, expect, beforeEach } from "vitest";
import { createCallerFactory } from "@trpc/server/unstable-core-do-not-import";
import pino from "pino";
import { appRouter } from "../router";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestTopic,
  createTestConfig,
} from "../../test-utils/db";
import type { AppDatabase } from "../../db";
import type { AppConfig } from "../../config";
import type { AppContext } from "../context";

describe("system router", () => {
  let db: AppDatabase;
  let caller: any;
  const config = createTestConfig();
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    db = createTestDatabase();
    const createCaller = (createCallerFactory() as any)(appRouter);
    const context: AppContext = { db, config, logger };
    caller = createCaller(context);
  });

  it("should return system status with config data (AC5.3)", async () => {
    const result = await caller.system.status();

    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      digestCron: "0 9 * * *",
    });
    expect(result.lastPollTime).toBeNull();
    expect(result.feedCount).toBe(0);
    expect(result.topicCount).toBe(0);
  });

  it("should include lastPollTime from most recent feed poll (AC5.3)", async () => {
    const now = new Date();
    const pastTime = new Date(now.getTime() - 60000); // 1 minute ago

    seedTestFeed(db, { lastPolledAt: pastTime });
    seedTestFeed(db, { lastPolledAt: now });

    const result = await caller.system.status();

    expect(result.lastPollTime).toBeDefined();
    expect(result.lastPollTime?.getTime()).toBeCloseTo(now.getTime(), -3);
  });

  it("should count total feeds (AC5.3)", async () => {
    seedTestFeed(db);
    seedTestFeed(db);
    seedTestFeed(db);

    const result = await caller.system.status();
    expect(result.feedCount).toBe(3);
  });

  it("should count total topics (AC5.3)", async () => {
    seedTestTopic(db);
    seedTestTopic(db);

    const result = await caller.system.status();
    expect(result.topicCount).toBe(2);
  });

  it("should return digestCron as raw cron expression string (AC5.3)", async () => {
    const customConfig: AppConfig = {
      ...config,
      schedule: {
        ...config.schedule,
        digest: "0 18 * * 1-5",
      },
    };

    const customCreateCaller = (createCallerFactory() as any)(appRouter);
    const context: AppContext = { db, config: customConfig, logger };
    const customCaller = customCreateCaller(context);

    const result = await customCaller.system.status();
    expect(result.digestCron).toBe("0 18 * * 1-5");
  });

  it("should return LLM provider and model from config (AC5.3)", async () => {
    const customConfig: AppConfig = {
      ...config,
      llm: {
        provider: "openai",
        model: "gpt-4",
      },
    };

    const customCreateCaller = (createCallerFactory() as any)(appRouter);
    const context: AppContext = { db, config: customConfig, logger };
    const customCaller = customCreateCaller(context);

    const result = await customCaller.system.status();
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
  });
});
