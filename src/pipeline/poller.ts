import Parser from "rss-parser";
import type { Logger } from "pino";
import type { ParsedRssItem, PollResult } from "./types";

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

    const items: Array<ParsedRssItem> = feed.items.map((item) => {
      const guid = item.guid ?? item.link ?? "";
      const metadata: Record<string, unknown> = {};

      if (item["prnIndustry"]) metadata["prnIndustry"] = item["prnIndustry"];
      if (item["prnSubject"]) metadata["prnSubject"] = item["prnSubject"];
      if (item["dcContributor"]) metadata["dcContributor"] = item["dcContributor"];

      return {
        guid,
        title: item.title ?? null,
        url: item.link ?? "",
        publishedAt: item.pubDate ? new Date(item.pubDate) : null,
        metadata,
      };
    });

    logger.info({ feedName, itemCount: items.length }, "feed polled successfully");
    return { feedName, items, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feedName, feedUrl, error: message }, "feed poll failed");
    return { feedName, items: [], error: message };
  }
}
