import Parser from "rss-parser";
import type { Logger } from "pino";
import type { ParsedRssItem, PollResult, SkippedItem } from "./types";

type CustomItem = {
  prnIndustry?: string;
  prnSubject?: string;
  dcContributor?: string;
};

function createParser(): Parser<Record<string, unknown>, CustomItem> {
  return new Parser<Record<string, unknown>, CustomItem>({
    customFields: {
      item: [
        ["prn:industry", "prnIndustry"],
        ["prn:subject", "prnSubject"],
        ["dc:contributor", "dcContributor"],
      ],
    },
  });
}

let parser: Parser<Record<string, unknown>, CustomItem> | null = null;

function getParser(): Parser<Record<string, unknown>, CustomItem> {
  if (!parser) {
    parser = createParser();
  }
  return parser;
}

export async function pollFeed(
  feedName: string,
  feedUrl: string,
  logger: Logger,
): Promise<PollResult> {
  try {
    const feed = await getParser().parseURL(feedUrl);

    const items: Array<ParsedRssItem> = [];
    const skippedItems: Array<SkippedItem> = [];

    for (const item of feed.items) {
      const rawGuid = item.guid ?? null;
      const rawLink = item.link ?? null;

      // Determine identity and URL with fallback logic:
      // - guid provides identity; link provides fetchability.
      // - Exception: if guid is itself a URL (starts with "http"), use it as both identity and URL.
      const guid = rawGuid ?? rawLink;
      const url =
        rawLink ?? (rawGuid && rawGuid.startsWith("http") ? rawGuid : null);

      if (!guid || !url) {
        const reason = !guid
          ? "missing both guid and link"
          : "guid is not a URL and link is missing";
        const skipped: SkippedItem = {
          title: item.title ?? null,
          reason,
        };
        skippedItems.push(skipped);
        logger.warn(
          { feedName, title: skipped.title, reason: skipped.reason },
          "skipping RSS item without usable identity or article URL",
        );
        continue;
      }

      const metadata: Record<string, unknown> = {};
      if (item["prnIndustry"]) metadata["prnIndustry"] = item["prnIndustry"];
      if (item["prnSubject"]) metadata["prnSubject"] = item["prnSubject"];
      if (item["dcContributor"]) metadata["dcContributor"] = item["dcContributor"];

      items.push({
        guid,
        title: item.title ?? null,
        url,
        publishedAt: item.pubDate ? new Date(item.pubDate) : null,
        metadata,
      });
    }

    logger.info(
      { feedName, itemCount: items.length, skippedCount: skippedItems.length },
      "feed polled successfully",
    );
    return { feedName, items, skippedItems, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feedName, feedUrl, error: message }, "feed poll failed");
    return { feedName, items: [], skippedItems: [], error: message };
  }
}
