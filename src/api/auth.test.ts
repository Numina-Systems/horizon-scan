import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  createTestDatabase,
  seedTestFeed,
  seedTestArticle,
  seedTestTopic,
  createTestConfig,
  createTestCaller,
} from "../test-utils/db";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles, feeds } from "../db/schema";
import { eq } from "drizzle-orm";
import { createApiServer, resolvePrincipal, resolveBindHost } from "./server";
import pino from "pino";

// S1: Mock the scheduler so system.triggerPoll resolves cleanly without
// network/LLM access. Using undefined (void) as the mock return value.
vi.mock("../scheduler", () => ({
  runPollCycle: vi.fn().mockResolvedValue(undefined),
}));

// --- Shared test helpers ---

function seedTestData(db: AppDatabase) {
  const feedId = seedTestFeed(db);
  const topicId = seedTestTopic(db);
  const articleId = seedTestArticle(db, feedId);
  return { feedId, topicId, articleId };
}

// Caller with auth enforcement ON and a valid principal (authenticated + authorized)
function createAuthedCaller(db: AppDatabase, key = "test-key") {
  return createTestCaller(db, {}, {
    authKey: key,
    principal: { id: "api-key-holder", role: "admin" },
  });
}

// Caller with auth enforcement ON but NO principal (authenticated mode, but no valid key)
function createUnauthedCaller(db: AppDatabase, key = "test-key") {
  return createTestCaller(db, {}, { authKey: key });
}

// Caller in dev mode (no enforcement)
function createDevCaller(db: AppDatabase) {
  return createTestCaller(db);
}

// --- resolvePrincipal unit tests (F3) ---

describe("resolvePrincipal (F3 — SHA-256 hashed timing-safe comparison)", () => {
  it("returns authorized principal for correct key", () => {
    expect(resolvePrincipal("Bearer secret-key", "secret-key"))
      .toEqual({ id: "api-key-holder", role: "admin" });
  });

  it("returns undefined for wrong key (not authorized)", () => {
    expect(resolvePrincipal("Bearer wrong-key", "secret-key"))
      .toBeUndefined();
  });

  it("returns undefined for missing header", () => {
    expect(resolvePrincipal(undefined, "secret-key"))
      .toBeUndefined();
  });

  it("returns undefined for malformed header (non-Bearer)", () => {
    expect(resolvePrincipal("Basic abc123", "secret-key"))
      .toBeUndefined();
  });

  it("returns undefined when no key configured (dev mode)", () => {
    expect(resolvePrincipal("Bearer anything", undefined))
      .toBeUndefined();
  });

  it("returns undefined for empty token", () => {
    expect(resolvePrincipal("Bearer ", "secret-key"))
      .toBeUndefined();
  });

  it("should reject both short and long wrong keys", () => {
    // Both the token and expected key are SHA-256 hashed to 32 bytes before
    // comparison (F3), so different-length wrong keys all take the same
    // rejection path. This test verifies the rejection, not timing — the
    // SHA-256 approach itself is verified by code review.
    const short = resolvePrincipal("Bearer x", "secret-key");
    const long = resolvePrincipal("Bearer " + "x".repeat(1000), "secret-key");
    expect(short).toBeUndefined();
    expect(long).toBeUndefined();
  });

  // RC-6: case-insensitive Bearer prefix matching
  it("accepts lowercase bearer prefix (RC-6)", () => {
    expect(resolvePrincipal("bearer secret-key", "secret-key"))
      .toEqual({ id: "api-key-holder", role: "admin" });
  });

  it("accepts mixed-case BEARER prefix (RC-6)", () => {
    expect(resolvePrincipal("BEARER secret-key", "secret-key"))
      .toEqual({ id: "api-key-holder", role: "admin" });
  });
});

// --- AC.A.1: Unauthenticated mutations rejected when API_KEY is set ---

describe("AC.A.1: unauthenticated mutations rejected when API key is set", () => {
  const protectedMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }) => Promise<unknown>]> = [
    ["feeds.create", (c) => c.feeds.create({
      name: "T", url: "https://t.com/rss",
      extractorConfig: { bodySelector: "article", jsonLd: true },
    })],
    ["feeds.update", (c, s) => c.feeds.update({ id: s.feedId, name: "X" })],
    ["feeds.delete", (c, s) => c.feeds.delete({ id: s.feedId })],
    ["topics.create", (c) => c.topics.create({ name: "T", description: "D" })],
    ["topics.update", (c, s) => c.topics.update({ id: s.topicId, name: "X" })],
    ["topics.delete", (c, s) => c.topics.delete({ id: s.topicId })],
    ["assessments.reassess", (c) => c.assessments.reassess({})],
    ["system.triggerPoll", (c) => c.system.triggerPoll()],
  ];

  it.each(protectedMatrix)("rejects unauthenticated %s", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createUnauthedCaller(db);
    await expect(call(caller, seed)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// --- AC.A.2: Unauthenticated reads succeed when API_KEY is set ---

describe("AC.A.2: unauthenticated reads succeed when API key is set", () => {
  const publicMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }) => Promise<unknown>]> = [
    ["feeds.list", (c) => c.feeds.list()],
    ["feeds.getById", (c, s) => c.feeds.getById({ id: s.feedId })],
    ["topics.list", (c) => c.topics.list()],
    ["topics.getById", (c, s) => c.topics.getById({ id: s.topicId })],
    ["assessments.list", (c) => c.assessments.list({})],
    ["assessments.getByArticle", (c, s) => c.assessments.getByArticle({ articleId: s.articleId })],
    ["system.status", (c) => c.system.status()],
    ["articles.list", (c) => c.articles.list({})],
    ["articles.getById", (c, s) => c.articles.getById({ id: s.articleId })],
    ["digests.list", (c) => c.digests.list({})],
  ];

  it.each(publicMatrix)("allows unauthenticated %s", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createUnauthedCaller(db);
    await expect(call(caller, seed)).resolves.toBeDefined();
  });
});

// --- AC.A.3: Authenticated calls succeed for ALL procedures (R3 fix) ---

describe("AC.A.3: authenticated calls succeed for ALL procedures", () => {
  const protectedMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }, db: AppDatabase) => Promise<unknown>]> = [
    ["feeds.create", (c) => c.feeds.create({
      name: "T", url: "https://t.com/rss",
      extractorConfig: { bodySelector: "article", jsonLd: true },
    })],
    ["feeds.update", (c, s) => c.feeds.update({ id: s.feedId, name: "Updated" })],
    ["feeds.delete", (_c, s, db) => {
      // Delete the article first to avoid FK constraint, then delete the feed
      db.delete(articles).where(eq(articles.id, s.articleId)).run();
      const caller = createAuthedCaller(db);
      return caller.feeds.delete({ id: s.feedId });
    }],
    ["topics.create", (c) => c.topics.create({ name: "T", description: "D" })],
    ["topics.update", (c, s) => c.topics.update({ id: s.topicId, name: "Updated" })],
    ["topics.delete", (c, s) => c.topics.delete({ id: s.topicId })],
    ["assessments.reassess", (c) => c.assessments.reassess({})],
    ["system.triggerPoll", (c) => c.system.triggerPoll()],
  ];

  it.each(protectedMatrix)("protected: %s succeeds with correct key", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createAuthedCaller(db);
    const result = await call(caller, seed, db);
    expect(result).toBeDefined();
  });

  const publicMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }) => Promise<unknown>]> = [
    ["feeds.list", (c) => c.feeds.list()],
    ["feeds.getById", (c, s) => c.feeds.getById({ id: s.feedId })],
    ["topics.list", (c) => c.topics.list()],
    ["topics.getById", (c, s) => c.topics.getById({ id: s.topicId })],
    ["assessments.list", (c) => c.assessments.list({})],
    ["assessments.getByArticle", (c, s) => c.assessments.getByArticle({ articleId: s.articleId })],
    ["system.status", (c) => c.system.status()],
    ["articles.list", (c) => c.articles.list({})],
    ["articles.getById", (c, s) => c.articles.getById({ id: s.articleId })],
    ["digests.list", (c) => c.digests.list({})],
  ];

  it.each(publicMatrix)("public: %s succeeds with correct key", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createAuthedCaller(db);
    await expect(call(caller, seed)).resolves.toBeDefined();
  });
});

// --- AC.A.4: All procedures work in dev mode (R4 fix) ---

describe("AC.A.4: all procedures work in dev mode (no API key)", () => {
  const protectedMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }, db: AppDatabase) => Promise<unknown>]> = [
    ["feeds.create", (c) => c.feeds.create({
      name: "T", url: "https://t.com/rss",
      extractorConfig: { bodySelector: "article", jsonLd: true },
    })],
    ["feeds.update", (c, s) => c.feeds.update({ id: s.feedId, name: "Updated" })],
    ["feeds.delete", (_c, s, db) => {
      // Delete the article first to avoid FK constraint, then delete the feed
      db.delete(articles).where(eq(articles.id, s.articleId)).run();
      const caller = createDevCaller(db);
      return caller.feeds.delete({ id: s.feedId });
    }],
    ["topics.create", (c) => c.topics.create({ name: "T", description: "D" })],
    ["topics.update", (c, s) => c.topics.update({ id: s.topicId, name: "Updated" })],
    ["topics.delete", (c, s) => c.topics.delete({ id: s.topicId })],
    ["assessments.reassess", (c) => c.assessments.reassess({})],
    ["system.triggerPoll", (c) => c.system.triggerPoll()],
  ];

  it.each(protectedMatrix)("protected: %s works in dev mode", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createDevCaller(db);
    const result = await call(caller, seed, db);
    expect(result).toBeDefined();
  });

  const publicMatrix: Array<[string, (c: ReturnType<typeof createTestCaller>, s: { feedId: number; topicId: number; articleId: number }) => Promise<unknown>]> = [
    ["feeds.list", (c) => c.feeds.list()],
    ["feeds.getById", (c, s) => c.feeds.getById({ id: s.feedId })],
    ["topics.list", (c) => c.topics.list()],
    ["topics.getById", (c, s) => c.topics.getById({ id: s.topicId })],
    ["assessments.list", (c) => c.assessments.list({})],
    ["assessments.getByArticle", (c, s) => c.assessments.getByArticle({ articleId: s.articleId })],
    ["system.status", (c) => c.system.status()],
    ["articles.list", (c) => c.articles.list({})],
    ["articles.getById", (c, s) => c.articles.getById({ id: s.articleId })],
    ["digests.list", (c) => c.digests.list({})],
  ];

  it.each(publicMatrix)("public: %s works in dev mode", async (_name, call) => {
    const db = createTestDatabase();
    const seed = seedTestData(db);
    const caller = createDevCaller(db);
    await expect(call(caller, seed)).resolves.toBeDefined();
  });

  // F9 — Dev-mode middleware test
  it("dev mode allows mutations even when principal is explicitly undefined", async () => {
    const db = createTestDatabase();
    // authKey absent → dev mode → principal is undefined but enforcement is skipped
    const caller = createTestCaller(db, {}, { authKey: undefined });
    const result = await caller.feeds.create({
      name: "Dev Feed",
      url: "https://example.com/rss",
      extractorConfig: { bodySelector: "article", jsonLd: true },
    });
    expect(result.id).toBeDefined();
  });
});

// --- AC.A.5: Server bind-host resolution (R1 fix) ---

describe("AC.A.5: resolveBindHost (R1)", () => {
  afterEach(() => {
    vi.stubEnv("BIND_HOST", "");
  });

  it("returns 127.0.0.1 when no env or config override is set (application default)", () => {
    vi.stubEnv("BIND_HOST", "");
    const config = createTestConfig();
    expect(resolveBindHost(config)).toBe("127.0.0.1");
  });

  it("returns 127.0.0.1 when api section is absent and no env var", () => {
    vi.stubEnv("BIND_HOST", "");
    const config = createTestConfig();
    expect(resolveBindHost(config)).toBe("127.0.0.1");
  });

  it("returns configured host when api.bindHost is set in config", () => {
    vi.stubEnv("BIND_HOST", "");
    const config: AppConfig = { ...createTestConfig(), api: { bindHost: "192.168.1.1" } };
    expect(resolveBindHost(config)).toBe("192.168.1.1");
  });

  it("BIND_HOST env var overrides config and default", () => {
    vi.stubEnv("BIND_HOST", "0.0.0.0");
    const config: AppConfig = { ...createTestConfig(), api: { bindHost: "127.0.0.1" } };
    expect(resolveBindHost(config)).toBe("0.0.0.0");
  });

  it("BIND_HOST env var overrides default when config has no api section", () => {
    vi.stubEnv("BIND_HOST", "0.0.0.0");
    const config = createTestConfig();
    expect(resolveBindHost(config)).toBe("0.0.0.0");
  });

  it("returns 127.0.0.1 when api.bindHost is an empty string (HIGH-1)", () => {
    vi.stubEnv("BIND_HOST", "");
    const config: AppConfig = { ...createTestConfig(), api: { bindHost: "" } };
    expect(resolveBindHost(config)).toBe("127.0.0.1");
  });

  it("returns 127.0.0.1 when api.bindHost is whitespace-only (HIGH-1)", () => {
    vi.stubEnv("BIND_HOST", "");
    const config: AppConfig = { ...createTestConfig(), api: { bindHost: "   " } };
    expect(resolveBindHost(config)).toBe("127.0.0.1");
  });
});

// --- S2: Non-admin role rejection ---

describe("S2: non-admin role rejection", () => {
  it("rejects principal with non-admin role even when present on context", async () => {
    const db = createTestDatabase();
    // authKey is set (enforcement ON) but principal has role: "viewer"
    // Cast to bypass the type constraint — this simulates a non-admin principal
    const caller = createTestCaller(db, {}, {
      authKey: "test-key",
      principal: { id: "some-viewer", role: "viewer" } as unknown as { id: string; role: "admin" },
    });
    await expect(
      caller.feeds.create({
        name: "T", url: "https://t.com/rss",
        extractorConfig: { bodySelector: "article", jsonLd: true },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// --- HTTP-level integration tests (F5, F10) ---

describe("HTTP auth integration (F5, F10)", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  function createApp(authKey?: string) {
    const context = {
      db,
      config: createTestConfig(),
      logger: pino({ level: "silent" }),
      model: null,
      embeddingModel: null,
    };
    return createApiServer(context, authKey);
  }

  it("F5: rejects unauthenticated mutation via HTTP when API key is set", async () => {
    const app = createApp("secret-key");
    const res = await request(app)
      .post("/api/trpc/feeds.create")
      .send({ name: "X", url: "https://x.com/rss", extractorConfig: { bodySelector: "article", jsonLd: true } });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(JSON.stringify(res.body.error)).toContain("UNAUTHORIZED");
  });

  it("F5: allows authenticated mutation via HTTP with correct key", async () => {
    const app = createApp("secret-key");
    const res = await request(app)
      .post("/api/trpc/feeds.create")
      .set("Authorization", "Bearer secret-key")
      .send({ name: "Authed", url: "https://example.com/rss", extractorConfig: { bodySelector: "article", jsonLd: true } });
    expect(res.status).not.toBe(401);
    // Assert the mutation actually succeeded — not just that it wasn't 401
    expect(res.body).toHaveProperty("result");
    expect(res.body.result).toHaveProperty("data");
    expect(res.body.result.data).toHaveProperty("id");
    // Verify the feed was actually persisted to the DB
    const dbFeeds = db.select().from(feeds).all();
    expect(dbFeeds.some((f) => f.name === "Authed")).toBe(true);
  });

  it("F5: allows reads via HTTP without auth when API key is set", async () => {
    const app = createApp("secret-key");
    const res = await request(app).get("/api/trpc/feeds.list");
    expect(res.status).not.toBe(401);
    // Assert the response contains actual data — not just that it wasn't 401
    expect(res.body).toHaveProperty("result");
    expect(res.body.result).toBeDefined();
    expect(res.body.result).toHaveProperty("data");
  });

  it("F5: rejects HTTP request with wrong key", async () => {
    const app = createApp("secret-key");
    const res = await request(app)
      .post("/api/trpc/feeds.create")
      .set("Authorization", "Bearer wrong-key")
      .send({ name: "X", url: "https://x.com/rss", extractorConfig: { bodySelector: "article", jsonLd: true } });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(JSON.stringify(res.body.error)).toContain("UNAUTHORIZED");
  });

  it("F5: allows mutations in dev mode (no API key) via HTTP", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/trpc/feeds.create")
      .send({ name: "Dev", url: "https://example.com/rss", extractorConfig: { bodySelector: "article", jsonLd: true } });
    expect(res.status).not.toBe(401);
    // Assert the mutation actually succeeded
    expect(res.body).toHaveProperty("result");
    expect(res.body.result).toHaveProperty("data");
    expect(res.body.result.data).toHaveProperty("id");
  });

  it("F10: 401 response includes WWW-Authenticate: Bearer header", async () => {
    const app = createApp("secret-key");
    const res = await request(app)
      .post("/api/trpc/feeds.create")
      .send({ name: "X", url: "https://x.com/rss", extractorConfig: { bodySelector: "article", jsonLd: true } });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });
});
