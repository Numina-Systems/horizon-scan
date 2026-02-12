// pattern: Imperative Shell
import { router, publicProcedure } from "../trpc";
import { feeds, topics } from "../../db/schema";
import { sql, desc } from "drizzle-orm";

export const systemRouter = router({
  status: publicProcedure.query(({ ctx }) => {
    const feedCount = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(feeds)
      .get()?.count ?? 0;

    const topicCount = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(topics)
      .get()?.count ?? 0;

    const lastPollResult = ctx.db
      .select({ lastPolledAt: feeds.lastPolledAt })
      .from(feeds)
      .orderBy(desc(feeds.lastPolledAt))
      .get();

    const lastPollTime = lastPollResult?.lastPolledAt ?? null;

    return {
      lastPollTime,
      digestCron: ctx.config.schedule.digest,
      provider: ctx.config.llm.provider,
      model: ctx.config.llm.model,
      feedCount,
      topicCount,
    };
  }),
});
