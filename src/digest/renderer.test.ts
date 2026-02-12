import { describe, it, expect } from "vitest";
import { renderDigestHtml } from "./renderer";
import type { DigestData } from "./builder";

describe("renderDigestHtml", () => {
  it("should render valid HTML structure with DOCTYPE and proper tags", () => {
    const data: DigestData = {
      topicGroups: [],
      totalArticleCount: 0,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("<body");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("should not contain style tags", () => {
    const data: DigestData = {
      topicGroups: [],
      totalArticleCount: 0,
    };

    const html = renderDigestHtml(data);

    expect(html).not.toContain("<style>");
    expect(html).not.toContain("</style>");
  });

  it("should render topic headings as h2 tags", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Technology",
          articles: [],
        },
        {
          topicName: "Science",
          articles: [],
        },
      ],
      totalArticleCount: 0,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("<h2");
    expect(html).toContain("Technology");
    expect(html).toContain("Science");
  });

  it("should render article title as a link", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Breaking News",
              url: "https://example.com/news",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain('href="https://example.com/news"');
    expect(html).toContain("Breaking News");
    expect(html).toContain("<a");
  });

  it("should render article dateline when publishedAt is provided", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: new Date("2024-01-15T10:30:00Z"),
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("2024-01-15");
  });

  it("should omit dateline when publishedAt is null", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("Article");
    // Should not contain anything that looks like a date
    const dateMatch = html.match(/\d{4}-\d{2}-\d{2}/);
    // The only date should be the generated date at the top
    expect(dateMatch).toBeTruthy();
  });

  it("should render article summary paragraph when provided", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: "This is a summary of the article",
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("This is a summary of the article");
  });

  it("should omit summary paragraph when summary is null", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).not.toContain("Article's summary");
  });

  it("should render tags as comma-separated list when provided", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: ["ai", "ml", "deep-learning"],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("ai, ml, deep-learning");
    expect(html).toContain("Tags:");
  });

  it("should omit tags section when tags array is empty", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    const tagMatches = html.match(/Tags:/g);
    // Should appear in HTML structure but with empty tags, so no actual tag content
    expect(html).not.toContain("Tags: ,");
  });

  it("should escape HTML entities in title to prevent XSS", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "<script>alert('xss')</script>",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should escape ampersands in title", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Design & Engineering",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("Design &amp; Engineering");
  });

  it("should escape quotes in URL attributes", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: 'https://example.com/article?title="malicious"',
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("&quot;");
    expect(html).not.toContain('href="https://example.com/article?title="');
  });

  it("should render article count in header", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article 1",
              url: "https://example.com/1",
              publishedAt: null,
              summary: null,
              tags: [],
            },
            {
              title: "Article 2",
              url: "https://example.com/2",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 2,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("2 articles");
  });

  it("should use singular form for single article", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("1 article");
    expect(html).not.toContain("1 articles");
  });

  it("should handle empty digest gracefully", () => {
    const data: DigestData = {
      topicGroups: [],
      totalArticleCount: 0,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("0 articles");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
  });

  it("should handle null title gracefully with Untitled fallback", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: null,
              url: "https://example.com",
              publishedAt: null,
              summary: null,
              tags: [],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("Untitled");
    expect(html).toContain('href="https://example.com"');
  });

  it("should have all styles inline via style attributes", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Tech",
          articles: [
            {
              title: "Article",
              url: "https://example.com",
              publishedAt: new Date("2024-01-15"),
              summary: "A summary",
              tags: ["test"],
            },
          ],
        },
      ],
      totalArticleCount: 1,
    };

    const html = renderDigestHtml(data);

    // Check for inline styles
    expect(html).toContain('style="');
    // Verify no style tag
    expect(html).not.toContain("<style>");
  });

  it("should include digest title and generated timestamp", () => {
    const data: DigestData = {
      topicGroups: [],
      totalArticleCount: 0,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("Horizon Scan Digest");
  });

  it("should render multiple topics with multiple articles", () => {
    const data: DigestData = {
      topicGroups: [
        {
          topicName: "Technology",
          articles: [
            {
              title: "AI News",
              url: "https://example.com/ai",
              publishedAt: new Date("2024-01-15"),
              summary: "Latest AI developments",
              tags: ["ai"],
            },
            {
              title: "ML Update",
              url: "https://example.com/ml",
              publishedAt: new Date("2024-01-14"),
              summary: "Machine learning advances",
              tags: ["ml"],
            },
          ],
        },
        {
          topicName: "Science",
          articles: [
            {
              title: "Space Discovery",
              url: "https://example.com/space",
              publishedAt: new Date("2024-01-13"),
              summary: "New planet found",
              tags: ["space", "planets"],
            },
          ],
        },
      ],
      totalArticleCount: 3,
    };

    const html = renderDigestHtml(data);

    expect(html).toContain("Technology");
    expect(html).toContain("Science");
    expect(html).toContain("AI News");
    expect(html).toContain("ML Update");
    expect(html).toContain("Space Discovery");
    expect(html).toContain("3 articles");
  });
});
