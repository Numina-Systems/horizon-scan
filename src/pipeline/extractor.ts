// pattern: functional-core
import * as cheerio from "cheerio";
import type { Logger } from "pino";
import type { ExtractorConfig } from "../db/schema";

export type ExtractionResult = {
  readonly extractedText: string;
  readonly jsonLdData: ReadonlyArray<Record<string, unknown>>;
};

/**
 * Extracts article content from HTML using configured CSS selectors and JSON-LD parsing.
 * @param html - The raw HTML content to extract from.
 * @param config - The extractor configuration with bodySelector and optional jsonLd flag.
 * @param logger - Logger instance for debug messages.
 * @returns Object with extractedText and jsonLdData array.
 */
export function extractContent(
  html: string,
  config: Readonly<ExtractorConfig>,
  logger: Logger,
): ExtractionResult {
  const $ = cheerio.load(html);

  // Extract body text using configured CSS selector
  const bodyElements = $(config.bodySelector);
  const extractedText = bodyElements
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0)
    .join("\n\n");

  // Extract JSON-LD structured data
  const jsonLdData: Array<Record<string, unknown>> = [];

  if (config.jsonLd) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) {
            // safe: checked typeof === 'object' && !== null above
            jsonLdData.push(parsed as Record<string, unknown>);
          }
        }
      } catch {
        logger.debug("failed to parse JSON-LD script tag");
      }
    });
  }

  // Extract metadata from configured selectors
  if (config.metadataSelectors) {
    for (const [key, selector] of Object.entries(config.metadataSelectors)) {
      const value = $(selector).text().trim();
      if (value) {
        // Metadata selectors are merged into JSON-LD data array as a separate object
        jsonLdData.push({ _source: "metadataSelector", [key]: value });
      }
    }
  }

  return { extractedText, jsonLdData };
}
