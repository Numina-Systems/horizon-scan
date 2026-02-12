import { describe, it, expect } from "vitest";
import pino from "pino";
import { seedDatabase } from "./seed";
import type { AppConfig } from "./config";
import type { AppDatabase } from "./db";
import { createTestDatabase } from "./test-utils/db";
import { feeds, topics } from "./db/schema";

/**
 * Creates a minimal AppConfig for testing seeding with custom feeds and topics.
 * @param feedOverrides - Optional array of feeds to include (defaults to 2 test feeds).
 * @param topicOverrides - Optional array of topics to include (defaults to 2 test topics).
 * @returns An AppConfig with the specified feeds and topics.
 */
function createSeedTestConfig(
  feedOverrides?: AppConfig["feeds"],
  topicOverrides?: AppConfig["topics"],
): AppConfig {
  return {
    llm: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    feeds: feedOverrides ?? [
      {
        name: "Test Feed 1",
        url: "https://example.com/feed1",
        extractorConfig: {
          bodySelector: "article",
          jsonLd: true,
        },
        pollIntervalMinutes: 15,
        enabled: true,
      },
      {
        name: "Test Feed 2",
        url: "https://example.com/feed2",
        extractorConfig: {
          bodySelector: ".content",
          jsonLd: false,
        },
        pollIntervalMinutes: 30,
        enabled: false,
      },
    ],
    topics: topicOverrides ?? [
      {
        name: "Technology",
        description: "Technology news and updates",
        enabled: true,
      },
      {
        name: "Science",
        description: "Science and research",
        enabled: true,
      },
    ],
    schedule: {
      poll: "*/15 * * * *",
      digest: "0 9 * * *",
    },
    digest: {
      recipient: "test@example.com",
    },
    extraction: {
      maxConcurrency: 2,
      perDomainDelayMs: 1000,
    },
    assessment: {
      maxArticleLength: 4000,
    },
  };
}

describe("seedDatabase", () => {
  describe("first run seeds feeds", () => {
    it("should insert feeds from config into empty database", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });
      const config = createSeedTestConfig();

      seedDatabase(db, config, logger);

      const seededFeeds = db
        .select({
          name: feeds.name,
          url: feeds.url,
          extractorConfig: feeds.extractorConfig,
          pollIntervalMinutes: feeds.pollIntervalMinutes,
          enabled: feeds.enabled,
        })
        .from(feeds)
        .all();

      expect(seededFeeds).toHaveLength(2);
      expect(seededFeeds[0]).toEqual({
        name: "Test Feed 1",
        url: "https://example.com/feed1",
        extractorConfig: {
          bodySelector: "article",
          jsonLd: true,
        },
        pollIntervalMinutes: 15,
        enabled: true,
      });
      expect(seededFeeds[1]).toEqual({
        name: "Test Feed 2",
        url: "https://example.com/feed2",
        extractorConfig: {
          bodySelector: ".content",
          jsonLd: false,
        },
        pollIntervalMinutes: 30,
        enabled: false,
      });
    });
  });

  describe("first run seeds topics", () => {
    it("should insert topics from config into empty database", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });
      const config = createSeedTestConfig();

      seedDatabase(db, config, logger);

      const seededTopics = db
        .select({
          name: topics.name,
          description: topics.description,
          enabled: topics.enabled,
        })
        .from(topics)
        .all();

      expect(seededTopics).toHaveLength(2);
      expect(seededTopics[0]).toEqual({
        name: "Technology",
        description: "Technology news and updates",
        enabled: true,
      });
      expect(seededTopics[1]).toEqual({
        name: "Science",
        description: "Science and research",
        enabled: true,
      });
    });
  });

  describe("idempotence", () => {
    it("should skip seeding when feeds already exist", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });
      const config1 = createSeedTestConfig();

      seedDatabase(db, config1, logger);

      const initialFeeds = db
        .select({ id: feeds.id, name: feeds.name })
        .from(feeds)
        .all();
      expect(initialFeeds).toHaveLength(2);

      // Call seedDatabase again with different config
      const config2 = createSeedTestConfig(
        [
          {
            name: "New Feed",
            url: "https://new.example.com/rss",
            extractorConfig: {
              bodySelector: "div",
              jsonLd: false,
            },
            pollIntervalMinutes: 60,
            enabled: true,
          },
        ],
        config1.topics,
      );

      seedDatabase(db, config2, logger);

      // Verify feed count unchanged (no duplicate inserts)
      const finalFeeds = db
        .select({ id: feeds.id, name: feeds.name })
        .from(feeds)
        .all();
      expect(finalFeeds).toHaveLength(2);

      // Verify original feed names unchanged
      const feedNames = finalFeeds.map((f) => f.name);
      expect(feedNames).toContain("Test Feed 1");
      expect(feedNames).toContain("Test Feed 2");
      expect(feedNames).not.toContain("New Feed");
    });

    it("should skip seeding when topics already exist", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });
      const config1 = createSeedTestConfig();

      seedDatabase(db, config1, logger);

      const initialTopics = db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .all();
      expect(initialTopics).toHaveLength(2);

      // Call seedDatabase again with different config
      const config2 = createSeedTestConfig(
        config1.feeds,
        [
          {
            name: "New Topic",
            description: "A brand new topic",
            enabled: true,
          },
        ],
      );

      seedDatabase(db, config2, logger);

      // Verify topic count unchanged
      const finalTopics = db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .all();
      expect(finalTopics).toHaveLength(2);

      // Verify original topic names unchanged
      const topicNames = finalTopics.map((t) => t.name);
      expect(topicNames).toContain("Technology");
      expect(topicNames).toContain("Science");
      expect(topicNames).not.toContain("New Topic");
    });
  });

  describe("independent seeding", () => {
    it("should seed topics even if feeds already exist", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });

      // Manually insert feeds to simulate prior run
      db.insert(feeds)
        .values({
          name: "Existing Feed",
          url: "https://existing.example.com/rss",
          extractorConfig: {
            bodySelector: "article",
            jsonLd: true,
          },
          enabled: true,
        })
        .run();

      // Seed with config containing feeds and topics
      const config = createSeedTestConfig();
      seedDatabase(db, config, logger);

      // Feeds should remain unchanged (1 from manual insert, not 3 from config)
      const allFeeds = db.select({ id: feeds.id }).from(feeds).all();
      expect(allFeeds).toHaveLength(1);

      // Topics should be seeded (2 from config)
      const allTopics = db.select({ id: topics.id }).from(topics).all();
      expect(allTopics).toHaveLength(2);
    });

    it("should seed feeds even if topics already exist", () => {
      const db = createTestDatabase();
      const logger = pino({ level: "silent" });

      // Manually insert topics to simulate prior run
      db.insert(topics)
        .values({
          name: "Existing Topic",
          description: "An existing topic",
          enabled: true,
        })
        .run();

      // Seed with config containing feeds and topics
      const config = createSeedTestConfig();
      seedDatabase(db, config, logger);

      // Feeds should be seeded (2 from config)
      const allFeeds = db.select({ id: feeds.id }).from(feeds).all();
      expect(allFeeds).toHaveLength(2);

      // Topics should remain unchanged (1 from manual insert, not 3 from config)
      const allTopics = db.select({ id: topics.id }).from(topics).all();
      expect(allTopics).toHaveLength(1);
    });
  });
});
