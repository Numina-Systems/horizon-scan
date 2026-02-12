// pattern: Imperative Shell
import { router } from "./trpc";
import { feedsRouter } from "./routers/feeds";
import { topicsRouter } from "./routers/topics";
import { articlesRouter } from "./routers/articles";
import { assessmentsRouter } from "./routers/assessments";
import { digestsRouter } from "./routers/digests";
import { systemRouter } from "./routers/system";

/**
 * Root tRPC router combining all domain-specific sub-routers.
 * Provides complete API for feeds, topics, articles, assessments, digests, and system status.
 */
export const appRouter = router({
  feeds: feedsRouter,
  topics: topicsRouter,
  articles: articlesRouter,
  assessments: assessmentsRouter,
  digests: digestsRouter,
  system: systemRouter,
});

/**
 * Inferred type of the root tRPC router.
 * Used for type-safe client code generation and caller factory typing.
 */
export type AppRouter = typeof appRouter;
