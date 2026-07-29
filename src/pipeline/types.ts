export type RssItemMetadata = Readonly<Record<string, unknown>>;

export type ParsedRssItem = {
  readonly guid: string;
  readonly title: string | null;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly metadata: RssItemMetadata;
};

export type SkippedItem = {
  readonly title: string | null;
  readonly reason: string;
};

export type PollResult = {
  readonly feedName: string;
  readonly items: ReadonlyArray<ParsedRssItem>;
  readonly skippedItems: ReadonlyArray<SkippedItem>;
  readonly error: string | null;
};

export type DedupResult = {
  readonly feedName: string;
  readonly newCount: number;
  readonly skippedCount: number;
};

export type EmbeddingDedupResult = {
  readonly processedCount: number;
  readonly duplicateCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
};
