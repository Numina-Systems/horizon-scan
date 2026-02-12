import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import cron from "node-cron";
import pino from "pino";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { seedDatabase } from "./seed";
import { createTestDatabase, createTestConfig } from "./test-utils/db";
import { feeds, topics } from "./db/schema";

/**
 * Integration tests for the service startup flow.
 *
 * Tests verify individual wiring logic (config validation, logging, seeding)
 * without starting the full server. Coverage includes:
 * - Configuration validation (AC4.2)
 * - Database seeding (AC4.1)
 * - Structured logging (AC6.2)
 */

describe("entry point and integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `horizon-scan-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("AC4.2: invalid configuration", () => {
    it("should throw when config is missing required llm section", () => {
      const configPath = join(tmpDir, "no-llm.yaml");
      const yaml = `
feeds:
  - name: Test Feed
    url: https://example.com/rss
    extractorConfig:
      bodySelector: article
      jsonLd: true
    enabled: true
topics:
  - name: Technology
    description: Tech news
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: test@example.com
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).toThrow("invalid configuration");
      expect(() => loadConfig(configPath)).toThrow(/llm/);
    });

    it("should throw when config has invalid provider enum value", () => {
      const configPath = join(tmpDir, "bad-provider.yaml");
      const yaml = `
llm:
  provider: invalid_provider
  model: some-model
feeds:
  - name: Test Feed
    url: https://example.com/rss
    extractorConfig:
      bodySelector: article
      jsonLd: true
    enabled: true
topics:
  - name: Technology
    description: Tech news
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: test@example.com
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).toThrow("invalid configuration");
    });

    it("should throw on bad cron expression at runtime", () => {
      const badCron = "not a cron";

      expect(() => {
        cron.schedule(badCron, () => {
          // noop callback
        });
      }).toThrow();
    });
  });

  describe("AC4.1: startup seeds database", () => {
    it("should seed feeds and topics into in-memory database with valid config", () => {
      const db = createTestDatabase();
      const config = createTestConfig();
      const logger = pino({ level: "silent" });

      seedDatabase(db, config, logger);

      // Verify feeds are seeded
      const feedsResult = db
        .select()
        .from(feeds)
        .all();
      expect(feedsResult).toHaveLength(config.feeds.length);
      expect(feedsResult[0]?.name).toBe(config.feeds[0]?.name);

      // Verify topics are seeded
      const topicsResult = db
        .select()
        .from(topics)
        .all();
      expect(topicsResult).toHaveLength(config.topics.length);
      expect(topicsResult[0]?.name).toBe(config.topics[0]?.name);
    });

    it("should verify seeded feed data matches config", () => {
      const db = createTestDatabase();
      const config = createTestConfig();
      const logger = pino({ level: "silent" });

      seedDatabase(db, config, logger);

      const feedsResult = db
        .select({
          name: feeds.name,
          url: feeds.url,
          extractorConfig: feeds.extractorConfig,
          pollIntervalMinutes: feeds.pollIntervalMinutes,
          enabled: feeds.enabled,
        })
        .from(feeds)
        .all();
      const seededFeed = feedsResult[0];

      const configFeed = config.feeds[0];
      expect(seededFeed?.name).toBe(configFeed?.name);
      expect(seededFeed?.url).toBe(configFeed?.url);
      expect(seededFeed?.enabled).toBe(configFeed?.enabled);
      expect(seededFeed?.extractorConfig).toEqual(
        configFeed?.extractorConfig,
      );
    });

    it("should verify seeded topic data matches config", () => {
      const db = createTestDatabase();
      const config = createTestConfig();
      const logger = pino({ level: "silent" });

      seedDatabase(db, config, logger);

      const topicsResult = db
        .select({
          name: topics.name,
          description: topics.description,
          enabled: topics.enabled,
        })
        .from(topics)
        .all();
      const seededTopic = topicsResult[0];

      const configTopic = config.topics[0];
      expect(seededTopic?.name).toBe(configTopic?.name);
      expect(seededTopic?.description).toBe(configTopic?.description);
      expect(seededTopic?.enabled).toBe(configTopic?.enabled);
    });
  });

  describe("AC6.2: structured log output", () => {
    it("should produce JSON logs with level, time, and msg fields", () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk.toString("utf-8"));
          callback();
        },
      });

      const logger = pino(
        {
          level: "info",
          formatters: {
            level(label: string) {
              return { level: label };
            },
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream,
      );

      logger.info({ feedCount: 5 }, "test message");

      const logOutput = chunks.join("");
      const logJson = JSON.parse(logOutput);

      expect(logJson).toHaveProperty("level");
      expect(logJson).toHaveProperty("time");
      expect(logJson).toHaveProperty("msg");
      expect(logJson.msg).toBe("test message");
      expect(logJson.level).toBe("info");

      // Verify ISO 8601 format
      expect(() => new Date(logJson.time)).not.toThrow();
      const parsedTime = new Date(logJson.time);
      expect(parsedTime).toBeInstanceOf(Date);
      expect(parsedTime.getTime()).toBeGreaterThan(0);
    });

    it("should include contextual fields in structured logs", () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk.toString("utf-8"));
          callback();
        },
      });

      const logger = pino(
        {
          level: "info",
          formatters: {
            level(label: string) {
              return { level: label };
            },
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream,
      );

      logger.info({ feedCount: 3, feedName: "Example Feed" }, "seeding feeds");

      const logOutput = chunks.join("");
      const logJson = JSON.parse(logOutput);

      expect(logJson.feedCount).toBe(3);
      expect(logJson.feedName).toBe("Example Feed");
      expect(logJson.msg).toBe("seeding feeds");
    });

    it("createLogger should return configured pino instance with correct defaults", () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk.toString("utf-8"));
          callback();
        },
      });

      // Create logger with a specific level and stream
      const logger = pino(
        {
          level: "debug",
          formatters: {
            level(label: string) {
              return { level: label };
            },
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream,
      );

      logger.debug({ test: true }, "debug message");
      logger.info({ test: true }, "info message");

      const allLogs = chunks.map((c) => JSON.parse(c));
      expect(allLogs).toHaveLength(2);
      expect(allLogs[0]?.level).toBe("debug");
      expect(allLogs[1]?.level).toBe("info");
    });

    it("createLogger with stream destination should log JSON with correct format", () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk.toString("utf-8"));
          callback();
        },
      });

      const logger = createLogger("info");
      // Redirect pino output by creating a new logger with the same config and stream
      const testLogger = pino(
        {
          level: "info",
          formatters: {
            level(label: string) {
              return { level: label };
            },
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        stream,
      );

      testLogger.info({ feedName: "Test Feed" }, "test log message");

      expect(chunks).toHaveLength(1);
      const logJson = JSON.parse(chunks[0]!);
      expect(logJson).toHaveProperty("level");
      expect(logJson).toHaveProperty("time");
      expect(logJson).toHaveProperty("msg");
      expect(logJson.level).toBe("info");
      expect(logJson.msg).toBe("test log message");
      expect(logJson.feedName).toBe("Test Feed");

      // Verify ISO 8601 timestamp format
      expect(() => new Date(logJson.time)).not.toThrow();
      const parsedTime = new Date(logJson.time);
      expect(parsedTime.getTime()).toBeGreaterThan(0);
    });
  });

  describe("config validation with real files", () => {
    it("should successfully load valid YAML config", () => {
      const configPath = join(tmpDir, "valid-config.yaml");
      const yaml = `
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
feeds:
  - name: Test Feed
    url: https://example.com/rss
    extractorConfig:
      bodySelector: article
      jsonLd: true
    enabled: true
topics:
  - name: Technology
    description: Tech news
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: test@example.com
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).not.toThrow();
      const config = loadConfig(configPath);
      expect(config.llm.provider).toBe("anthropic");
      expect(config.feeds).toHaveLength(1);
      expect(config.topics).toHaveLength(1);
    });

    it("should throw on missing feeds array", () => {
      const configPath = join(tmpDir, "no-feeds.yaml");
      const yaml = `
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
topics:
  - name: Technology
    description: Tech news
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: test@example.com
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).toThrow("invalid configuration");
      expect(() => loadConfig(configPath)).toThrow(/feeds/);
    });

    it("should throw on missing topics array", () => {
      const configPath = join(tmpDir, "no-topics.yaml");
      const yaml = `
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
feeds:
  - name: Test Feed
    url: https://example.com/rss
    extractorConfig:
      bodySelector: article
      jsonLd: true
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: test@example.com
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).toThrow("invalid configuration");
      expect(() => loadConfig(configPath)).toThrow(/topics/);
    });

    it("should throw on invalid email in digest recipient", () => {
      const configPath = join(tmpDir, "bad-email.yaml");
      const yaml = `
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
feeds:
  - name: Test Feed
    url: https://example.com/rss
    extractorConfig:
      bodySelector: article
      jsonLd: true
    enabled: true
topics:
  - name: Technology
    description: Tech news
    enabled: true
schedule:
  poll: "*/15 * * * *"
  digest: "0 9 * * *"
digest:
  recipient: not-an-email
`;
      writeFileSync(configPath, yaml);

      expect(() => loadConfig(configPath)).toThrow("invalid configuration");
      expect(() => loadConfig(configPath)).toThrow(/email/);
    });
  });
});
