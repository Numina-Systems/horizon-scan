import { describe, it, expect } from "vitest";
import pino from "pino";
import { extractContent } from "./extractor";
import type { ExtractorConfig } from "../db/schema";

const logger = pino({ level: "silent" });

describe("extractContent", () => {
  describe("body text extraction", () => {
    it("should extract text from elements matching bodySelector", () => {
      const html = `
        <html>
          <body>
            <p class="content">First paragraph</p>
            <p class="content">Second paragraph</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("First paragraph\n\nSecond paragraph");
    });

    it("should return empty string when bodySelector matches no elements", () => {
      const html = `
        <html>
          <body>
            <article>Some content</article>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.nonexistent",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("");
    });

    it("should handle nested elements with multiple text nodes", () => {
      const html = `
        <html>
          <body>
            <div class="article">
              <p>Paragraph one</p>
              <p>Paragraph two</p>
            </div>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "div.article",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toContain("Paragraph one");
      expect(result.extractedText).toContain("Paragraph two");
    });

    it("should trim whitespace from extracted text", () => {
      const html = `
        <html>
          <body>
            <p class="content">
              Text with extra whitespace
            </p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("Text with extra whitespace");
    });
  });

  describe("JSON-LD parsing", () => {
    it("should parse single JSON-LD script tag when jsonLd is true", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"NewsArticle","headline":"Test Article"}
            </script>
          </head>
          <body>
            <p class="content">Article body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(1);
      expect(result.jsonLdData[0]).toBeDefined();
      if (result.jsonLdData[0]) {
        expect(result.jsonLdData[0]["@type"]).toBe("NewsArticle");
        expect(result.jsonLdData[0]["headline"]).toBe("Test Article");
      }
    });

    it("should parse multiple JSON-LD script tags", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"NewsArticle","headline":"Article 1"}
            </script>
            <script type="application/ld+json">
              {"@type":"BreadcrumbList","itemListElement":[{"name":"Home"}]}
            </script>
          </head>
          <body>
            <p class="content">Body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(2);
      expect(result.jsonLdData[0]).toBeDefined();
      expect(result.jsonLdData[1]).toBeDefined();
      if (result.jsonLdData[0] && result.jsonLdData[1]) {
        expect(result.jsonLdData[0]["@type"]).toBe("NewsArticle");
        expect(result.jsonLdData[1]["@type"]).toBe("BreadcrumbList");
      }
    });

    it("should silently skip malformed JSON-LD", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"NewsArticle","headline":"Valid"}
            </script>
            <script type="application/ld+json">
              {invalid json}
            </script>
            <script type="application/ld+json">
              {"@type":"BreadcrumbList"}
            </script>
          </head>
          <body>
            <p class="content">Body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(2);
      expect(result.jsonLdData[0]).toBeDefined();
      expect(result.jsonLdData[1]).toBeDefined();
      if (result.jsonLdData[0] && result.jsonLdData[1]) {
        expect(result.jsonLdData[0]["@type"]).toBe("NewsArticle");
        expect(result.jsonLdData[1]["@type"]).toBe("BreadcrumbList");
      }
    });

    it("should not parse JSON-LD when jsonLd is false", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"NewsArticle","headline":"Test"}
            </script>
          </head>
          <body>
            <p class="content">Body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(0);
    });

    it("should ignore non-object JSON-LD values", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              "string value"
            </script>
            <script type="application/ld+json">
              123
            </script>
            <script type="application/ld+json">
              {"@type":"NewsArticle"}
            </script>
          </head>
          <body>
            <p class="content">Body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(1);
      expect(result.jsonLdData[0]).toBeDefined();
      if (result.jsonLdData[0]) {
        expect(result.jsonLdData[0]["@type"]).toBe("NewsArticle");
      }
    });
  });

  describe("metadata selectors", () => {
    it("should extract metadata when metadataSelectors is provided", () => {
      const html = `
        <html>
          <head>
            <meta name="author" content="John Doe">
            <meta name="date" content="2026-02-12">
          </head>
          <body>
            <p class="content">Body text</p>
            <span class="author-name">Jane Smith</span>
            <span class="pub-date">2026-02-13</span>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: false,
        metadataSelectors: {
          author: "span.author-name",
          publishDate: "span.pub-date",
        },
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(2);
      expect(result.jsonLdData[0]).toBeDefined();
      expect(result.jsonLdData[1]).toBeDefined();
      if (result.jsonLdData[0] && result.jsonLdData[1]) {
        expect(result.jsonLdData[0]["_source"]).toBe("metadataSelector");
        expect(result.jsonLdData[0]["author"]).toBe("Jane Smith");
        expect(result.jsonLdData[1]["_source"]).toBe("metadataSelector");
        expect(result.jsonLdData[1]["publishDate"]).toBe("2026-02-13");
      }
    });

    it("should skip metadata selectors that match no elements", () => {
      const html = `
        <html>
          <body>
            <p class="content">Body text</p>
            <span class="author">John Doe</span>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: false,
        metadataSelectors: {
          author: "span.author",
          nonexistent: "span.missing",
        },
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(1);
      expect(result.jsonLdData[0]).toEqual({
        _source: "metadataSelector",
        author: "John Doe",
      });
    });

    it("should combine JSON-LD and metadata selectors", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"NewsArticle","headline":"Title"}
            </script>
          </head>
          <body>
            <p class="content">Body text</p>
            <span class="author">John Doe</span>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
        metadataSelectors: {
          author: "span.author",
        },
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(2);
      expect(result.jsonLdData[0]).toBeDefined();
      expect(result.jsonLdData[1]).toBeDefined();
      if (result.jsonLdData[0] && result.jsonLdData[1]) {
        expect(result.jsonLdData[0]["@type"]).toBe("NewsArticle");
        expect(result.jsonLdData[1]["_source"]).toBe("metadataSelector");
        expect(result.jsonLdData[1]["author"]).toBe("John Doe");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle empty HTML", () => {
      const html = "";

      const config: ExtractorConfig = {
        bodySelector: "p",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("");
      expect(result.jsonLdData).toHaveLength(0);
    });

    it("should handle HTML with no body matching selector", () => {
      const html = "<html><head></head><body></body></html>";

      const config: ExtractorConfig = {
        bodySelector: "article",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("");
      expect(result.jsonLdData).toHaveLength(0);
    });

    it("should handle script tags that are empty", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json"></script>
          </head>
          <body>
            <p class="content">Body</p>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "p.content",
        jsonLd: true,
      };

      const result = extractContent(html, config, logger);

      expect(result.jsonLdData).toHaveLength(0);
    });

    it("should handle complex nested selector patterns", () => {
      const html = `
        <html>
          <body>
            <main>
              <article>
                <section class="body">
                  <p>Paragraph 1</p>
                  <p>Paragraph 2</p>
                </section>
              </article>
            </main>
          </body>
        </html>
      `;

      const config: ExtractorConfig = {
        bodySelector: "main article section.body p",
        jsonLd: false,
      };

      const result = extractContent(html, config, logger);

      expect(result.extractedText).toBe("Paragraph 1\n\nParagraph 2");
    });
  });
});
