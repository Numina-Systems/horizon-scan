export type RssItemMetadata = Readonly<Record<string, unknown>>;

export type ParsedRssItem = {
  readonly guid: string;
  readonly title: string | null;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly metadata: RssItemMetadata;
};

export type PollResult = {
  readonly feedName: string;
  readonly items: ReadonlyArray<ParsedRssItem>;
  readonly error: string | null;
};

export type DedupResult = {
  readonly feedName: string;
  readonly newCount: number;
  readonly skippedCount: number;
};
