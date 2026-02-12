import { router } from "./trpc";
import { feedsRouter } from "./routers/feeds";
import { topicsRouter } from "./routers/topics";
import { articlesRouter } from "./routers/articles";
import { assessmentsRouter } from "./routers/assessments";
import { digestsRouter } from "./routers/digests";
import { systemRouter } from "./routers/system";

export const appRouter = router({
  feeds: feedsRouter,
  topics: topicsRouter,
  articles: articlesRouter,
  assessments: assessmentsRouter,
  digests: digestsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
