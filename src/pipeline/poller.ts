import Parser from "rss-parser";
import type { Logger } from "pino";
import type { ParsedRssItem, PollResult, SkippedItem } from "./types";
import { guardedFetch } from "../security/fetch-guard";

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
  maxFeedItems: number = 500,
  maxResponseBytes: number = 10_000_000,
  maxRedirects: number = 5,
): Promise<PollResult> {
  try {
    // Fetch feed XML via guardedFetch — gets SSRF protection (URL validation,
    // DNS pinning, per-hop redirect validation, byte capping) that parseURL does NOT provide.
    const fetchResult = await guardedFetch(feedUrl, {
      maxBytes: maxResponseBytes,
      maxRedirects,
      headers: {
        "User-Agent": "HorizonScan/1.0 (RSS feed poller)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });

    if (!fetchResult.ok) {
      logger.warn(
        { feedName, feedUrl, error: fetchResult.error },
        "feed fetch rejected by guardedFetch",
      );
      return {
        feedName,
        items: [],
        skippedItems: [],
        error: fetchResult.error,
      };
    }

    // Parse the bounded XML string — rss-parser never makes a network request.
    // This closes ALL feed SSRF gaps (redirects, byte capping, DNS pinning).
    const feed = await getParser().parseString(fetchResult.body);

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

    const truncatedItems =
      items.length > maxFeedItems ? items.slice(0, maxFeedItems) : items;

    logger.info(
      {
        feedName,
        itemCount: truncatedItems.length,
        skippedCount: skippedItems.length,
        ...(items.length > maxFeedItems && {
          originalCount: items.length,
          truncated: true,
        }),
      },
      "feed polled successfully",
    );
    return {
      feedName,
      items: truncatedItems,
      skippedItems,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feedName, feedUrl, error: message }, "feed poll failed");
    return { feedName, items: [], skippedItems: [], error: message };
  }
}
