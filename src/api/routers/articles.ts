// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { articles, assessments } from "../../db/schema";
import { eq, and } from "drizzle-orm";

/**
 * tRPC router for reading articles.
 * Provides queries for listing and retrieving articles with optional filtering and assessments.
 */
export const articlesRouter = router({
  list: publicProcedure
    .input(
      z.object({
        feedId: z.number().optional(),
        status: z.enum(["pending_assessment", "assessed", "failed"]).optional(),
        limit: z.number().int().positive().default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
    )
    .query(({ ctx, input }) => {
      const conditions: Array<ReturnType<typeof eq>> = [];
      if (input.feedId !== undefined) {
        conditions.push(eq(articles.feedId, input.feedId));
      }
      if (input.status !== undefined) {
        conditions.push(eq(articles.status, input.status));
      }

      const baseQuery = ctx.db.select().from(articles);
      const queryWithWhere =
        conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

      return queryWithWhere
        .limit(input.limit)
        .offset(input.offset)
        .all();
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => {
      const article = ctx.db
        .select()
        .from(articles)
        .where(eq(articles.id, input.id))
        .get();

      if (!article) {
        return null;
      }

      const articleAssessments = ctx.db
        .select()
        .from(assessments)
        .where(eq(assessments.articleId, input.id))
        .all();

      return {
        ...article,
        assessments: articleAssessments,
      };
    }),
});
