import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { extractPendingArticles } from "./extract-articles";
import { createTestDatabase, seedTestFeed } from "../test-utils/db";
import type { AppDatabase } from "../db";
import { articles } from "../db/schema";
import { eq } from "drizzle-orm";

describe("extractPendingArticles", () => {
  let db: AppDatabase;
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    db = createTestDatabase();
  });

  it("should extract text from article with rawHtml", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: false,
      },
    });

    const html = `
      <html>
        <body>
          <p class="content">Article body text</p>
        </body>
      </html>
    `;

    db.insert(articles)
      .values({
        feedId,
        guid: "test-1",
        url: "https://example.com/article1",
        status: "pending_assessment",
        rawHtml: html,
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-1")).get();
    expect(article?.extractedText).toBe("Article body text");
  });

  it("should skip articles that already have extractedText", () => {
    const feedId = seedTestFeed(db);

    const html = `
      <html>
        <body>
          <p class="content">New text</p>
        </body>
      </html>
    `;

    db.insert(articles)
      .values({
        feedId,
        guid: "test-2",
        url: "https://example.com/article2",
        status: "pending_assessment",
        rawHtml: html,
        extractedText: "Original extracted text",
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-2")).get();
    expect(article?.extractedText).toBe("Original extracted text");
  });

  it("should skip articles without rawHtml", () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-3",
        url: "https://example.com/article3",
        status: "pending_assessment",
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-3")).get();
    expect(article?.extractedText).toBeNull();
  });

  it("should merge JSON-LD data with existing metadata", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: true,
      },
    });

    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {"@type":"NewsArticle","headline":"Test Article"}
          </script>
        </head>
        <body>
          <p class="content">Article text</p>
        </body>
      </html>
    `;

    db.insert(articles)
      .values({
        feedId,
        guid: "test-4",
        url: "https://example.com/article4",
        status: "pending_assessment",
        rawHtml: html,
        metadata: { prnIndustry: "Tech", source: "PRNewswire" },
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-4")).get();
    expect(article?.extractedText).toBe("Article text");
    expect(article?.metadata).toBeDefined();

    const metadata = article?.metadata as Record<string, unknown>;
    expect(metadata["prnIndustry"]).toBe("Tech");
    expect(metadata["source"]).toBe("PRNewswire");
    expect(metadata["jsonLd"]).toBeDefined();

    const jsonLdArray = metadata["jsonLd"] as Array<Record<string, unknown>>;
    expect(jsonLdArray).toHaveLength(1);
    expect(jsonLdArray[0]?.["@type"]).toBe("NewsArticle");
    expect(jsonLdArray[0]?.["headline"]).toBe("Test Article");
  });

  it("should extract multiple JSON-LD objects", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: true,
      },
    });

    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {"@type":"NewsArticle","headline":"Test"}
          </script>
          <script type="application/ld+json">
            {"@type":"BreadcrumbList","itemListElement":[]}
          </script>
        </head>
        <body>
          <p class="content">Text</p>
        </body>
      </html>
    `;

    db.insert(articles)
      .values({
        feedId,
        guid: "test-5",
        url: "https://example.com/article5",
        status: "pending_assessment",
        rawHtml: html,
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-5")).get();
    const metadata = article?.metadata as Record<string, unknown>;
    const jsonLdArray = metadata["jsonLd"] as Array<Record<string, unknown>>;

    expect(jsonLdArray).toHaveLength(2);
    expect(jsonLdArray[0]?.["@type"]).toBe("NewsArticle");
    expect(jsonLdArray[1]?.["@type"]).toBe("BreadcrumbList");
  });

  it("should handle extraction error gracefully and skip the article", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: false,
      },
    });

    const validHtml = `
      <html>
        <body>
          <p class="content">Valid article</p>
        </body>
      </html>
    `;

    // Insert two articles - one that will be extracted successfully
    db.insert(articles)
      .values({
        feedId,
        guid: "test-6a",
        url: "https://example.com/article6a",
        status: "pending_assessment",
        rawHtml: validHtml,
      })
      .run();

    db.insert(articles)
      .values({
        feedId,
        guid: "test-6b",
        url: "https://example.com/article6b",
        status: "pending_assessment",
        rawHtml: validHtml,
      })
      .run();

    extractPendingArticles(db, logger);

    const article1 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-6a"))
      .get();
    const article2 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-6b"))
      .get();

    expect(article1?.extractedText).toBe("Valid article");
    expect(article2?.extractedText).toBe("Valid article");
  });

  it("should skip articles with null rawHtml but extractedText set", () => {
    const feedId = seedTestFeed(db);

    db.insert(articles)
      .values({
        feedId,
        guid: "test-7",
        url: "https://example.com/article7",
        status: "pending_assessment",
        rawHtml: null,
        extractedText: "Already extracted",
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-7")).get();
    expect(article?.extractedText).toBe("Already extracted");
  });

  it("should skip articles with status other than pending_assessment", () => {
    const feedId = seedTestFeed(db);

    const html = `
      <html>
        <body>
          <p class="content">Article</p>
        </body>
      </html>
    `;

    db.insert(articles)
      .values({
        feedId,
        guid: "test-8",
        url: "https://example.com/article8",
        status: "assessed",
        rawHtml: html,
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-8")).get();
    expect(article?.extractedText).toBeNull();
  });

  it("should continue extracting when one article has extraction errors", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: false,
      },
    });

    // Create two articles, both will extract successfully
    db.insert(articles)
      .values({
        feedId,
        guid: "test-9a",
        url: "https://example.com/article9a",
        status: "pending_assessment",
        rawHtml: "<html><body><p class='content'>Article 9a</p></body></html>",
      })
      .run();

    db.insert(articles)
      .values({
        feedId,
        guid: "test-9b",
        url: "https://example.com/article9b",
        status: "pending_assessment",
        rawHtml: "<html><body><p class='content'>Article 9b</p></body></html>",
      })
      .run();

    extractPendingArticles(db, logger);

    const article1 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-9a"))
      .get();
    const article2 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-9b"))
      .get();

    expect(article1?.extractedText).toBe("Article 9a");
    expect(article2?.extractedText).toBe("Article 9b");
  });

  it("should extract text from multiple articles in one cycle", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: false,
      },
    });

    const html1 = "<html><body><p class='content'>First article</p></body></html>";
    const html2 = "<html><body><p class='content'>Second article</p></body></html>";
    const html3 = "<html><body><p class='content'>Third article</p></body></html>";

    db.insert(articles)
      .values({
        feedId,
        guid: "test-10a",
        url: "https://example.com/article10a",
        status: "pending_assessment",
        rawHtml: html1,
      })
      .run();

    db.insert(articles)
      .values({
        feedId,
        guid: "test-10b",
        url: "https://example.com/article10b",
        status: "pending_assessment",
        rawHtml: html2,
      })
      .run();

    db.insert(articles)
      .values({
        feedId,
        guid: "test-10c",
        url: "https://example.com/article10c",
        status: "pending_assessment",
        rawHtml: html3,
      })
      .run();

    extractPendingArticles(db, logger);

    const article1 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-10a"))
      .get();
    const article2 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-10b"))
      .get();
    const article3 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-10c"))
      .get();

    expect(article1?.extractedText).toBe("First article");
    expect(article2?.extractedText).toBe("Second article");
    expect(article3?.extractedText).toBe("Third article");
  });

  it("should use feed-specific extractorConfig for each article", () => {
    const feed1Id = seedTestFeed(db, {
      name: "Feed 1",
      extractorConfig: {
        bodySelector: "div.article",
        jsonLd: false,
      },
    });

    const feed2Id = seedTestFeed(db, {
      name: "Feed 2",
      extractorConfig: {
        bodySelector: "span.content",
        jsonLd: false,
      },
    });

    const html1 = "<html><body><div class='article'>Feed 1 content</div></body></html>";
    const html2 = "<html><body><span class='content'>Feed 2 content</span></body></html>";

    db.insert(articles)
      .values({
        feedId: feed1Id,
        guid: "test-11a",
        url: "https://example.com/article11a",
        status: "pending_assessment",
        rawHtml: html1,
      })
      .run();

    db.insert(articles)
      .values({
        feedId: feed2Id,
        guid: "test-11b",
        url: "https://example.com/article11b",
        status: "pending_assessment",
        rawHtml: html2,
      })
      .run();

    extractPendingArticles(db, logger);

    const article1 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-11a"))
      .get();
    const article2 = db
      .select()
      .from(articles)
      .where(eq(articles.guid, "test-11b"))
      .get();

    expect(article1?.extractedText).toBe("Feed 1 content");
    expect(article2?.extractedText).toBe("Feed 2 content");
  });

  it("should preserve null metadata when extracting", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p.content",
        jsonLd: false,
      },
    });

    const html = "<html><body><p class='content'>Text</p></body></html>";

    db.insert(articles)
      .values({
        feedId,
        guid: "test-12",
        url: "https://example.com/article12",
        status: "pending_assessment",
        rawHtml: html,
        metadata: null,
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-12")).get();
    expect(article?.extractedText).toBe("Text");
    expect(article?.metadata).toBeDefined();

    const metadata = article?.metadata as Record<string, unknown>;
    expect(metadata["jsonLd"]).toBeDefined();
  });

  it("should handle articles with empty extractorConfig metadataSelectors", () => {
    const feedId = seedTestFeed(db, {
      extractorConfig: {
        bodySelector: "p",
        jsonLd: false,
        metadataSelectors: undefined,
      },
    });

    const html = "<html><body><p>Content</p></body></html>";

    db.insert(articles)
      .values({
        feedId,
        guid: "test-13",
        url: "https://example.com/article13",
        status: "pending_assessment",
        rawHtml: html,
      })
      .run();

    extractPendingArticles(db, logger);

    const article = db.select().from(articles).where(eq(articles.guid, "test-13")).get();
    expect(article?.extractedText).toBe("Content");
  });
});
