import { describe, it, expect } from "vitest";
import { appConfigSchema, type AppConfig } from "./schema";

describe("appConfigSchema", () => {
  const validBaseConfig = {
    llm: {
      provider: "ollama" as const,
      model: "test-model",
    },
    feeds: [
      {
        name: "Test Feed",
        url: "https://example.com/feed.rss",
        extractorConfig: {
          bodySelector: "p",
          jsonLd: false,
        },
      },
    ],
    topics: [
      {
        name: "Test Topic",
        description: "A test topic",
      },
    ],
    schedule: {
      poll: "*/15 * * * *",
      digest: "0 9 * * *",
    },
    digest: {
      recipient: "test@example.com",
    },
  };

  describe("dedup section - embedding-dedup.AC5.1: similarityThreshold validation", () => {
    it("should accept similarityThreshold of 0", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(0);
      }
    });

    it("should accept similarityThreshold of 0.5", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.5,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(0.5);
      }
    });

    it("should accept similarityThreshold of 0.9", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(0.9);
      }
    });

    it("should accept similarityThreshold of 1", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 1,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(1);
      }
    });

    it("should reject similarityThreshold below 0", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: -0.1,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject similarityThreshold above 1", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 1.1,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should default similarityThreshold to 0.9 when dedup section omitted", () => {
      const config = validBaseConfig;

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(0.9);
      }
    });

    it("should default similarityThreshold to 0.9 when dedup section is empty", () => {
      const config = {
        ...validBaseConfig,
        dedup: {},
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.similarityThreshold).toBe(0.9);
      }
    });
  });

  describe("dedup section - embedding-dedup.AC5.2: defaultLookbackDays validation", () => {
    it("should accept defaultLookbackDays of 1", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 1,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.defaultLookbackDays).toBe(1);
      }
    });

    it("should accept defaultLookbackDays of 15", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 15,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.defaultLookbackDays).toBe(15);
      }
    });

    it("should accept defaultLookbackDays of 30", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 30,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.defaultLookbackDays).toBe(30);
      }
    });

    it("should reject defaultLookbackDays of 0", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 0,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject defaultLookbackDays of -1", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: -1,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject defaultLookbackDays as float", () => {
      const config = {
        ...validBaseConfig,
        dedup: {
          similarityThreshold: 0.9,
          defaultLookbackDays: 1.5,
        },
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should default defaultLookbackDays to 15 when dedup section omitted", () => {
      const config = validBaseConfig;

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.defaultLookbackDays).toBe(15);
      }
    });

    it("should default defaultLookbackDays to 15 when dedup section is empty", () => {
      const config = {
        ...validBaseConfig,
        dedup: {},
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dedup.defaultLookbackDays).toBe(15);
      }
    });
  });

  describe("per-feed - embedding-dedup.AC5.3: dedupLookbackDays override", () => {
    it("should accept per-feed dedupLookbackDays override", () => {
      const config = {
        ...validBaseConfig,
        feeds: [
          {
            name: "Test Feed with Override",
            url: "https://example.com/feed.rss",
            extractorConfig: {
              bodySelector: "p",
              jsonLd: false,
            },
            dedupLookbackDays: 7,
          },
        ],
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.feeds[0]?.dedupLookbackDays).toBe(7);
      }
    });

    it("should allow per-feed dedupLookbackDays to be absent (use global default)", () => {
      const config = validBaseConfig;

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.feeds[0]?.dedupLookbackDays).toBeUndefined();
      }
    });

    it("should validate per-feed dedupLookbackDays as positive integer", () => {
      const config = {
        ...validBaseConfig,
        feeds: [
          {
            name: "Test Feed",
            url: "https://example.com/feed.rss",
            extractorConfig: {
              bodySelector: "p",
              jsonLd: false,
            },
            dedupLookbackDays: 0,
          },
        ],
      };

      const result = appConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});
