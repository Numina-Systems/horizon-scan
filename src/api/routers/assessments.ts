// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { articles, assessments } from "../../db/schema";
import { eq, and, inArray, or } from "drizzle-orm";

/**
 * tRPC router for reading assessments.
 * Provides queries for listing and retrieving assessments with optional filtering.
 */
export const assessmentsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        articleId: z.number().optional(),
        topicId: z.number().optional(),
        relevant: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const conditions: Array<ReturnType<typeof eq>> = [];
      if (input.articleId !== undefined) {
        conditions.push(eq(assessments.articleId, input.articleId));
      }
      if (input.topicId !== undefined) {
        conditions.push(eq(assessments.topicId, input.topicId));
      }
      if (input.relevant !== undefined) {
        conditions.push(eq(assessments.relevant, input.relevant));
      }

      const baseQuery = ctx.db.select().from(assessments);
      const queryWithWhere =
        conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

      return queryWithWhere.all();
    }),

  getByArticle: publicProcedure
    .input(z.object({ articleId: z.number() }))
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(assessments)
        .where(eq(assessments.articleId, input.articleId))
        .all();
    }),

  reassess: publicProcedure
    .input(
      z.object({
        articleId: z.number().optional(),
        includeFailed: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const statusConditions = input.includeFailed
        ? or(eq(articles.status, "assessed"), eq(articles.status, "failed"))
        : eq(articles.status, "assessed");

      const articleCondition = input.articleId
        ? and(eq(articles.id, input.articleId), statusConditions)
        : statusConditions;

      const matchingArticles = ctx.db
        .select({ id: articles.id })
        .from(articles)
        .where(articleCondition)
        .all();

      if (matchingArticles.length === 0) {
        return { assessmentsDeleted: 0, articlesReset: 0 };
      }

      const articleIds = matchingArticles.map((a) => a.id);

      const deleted = ctx.db
        .delete(assessments)
        .where(inArray(assessments.articleId, articleIds))
        .returning({ id: assessments.id })
        .all();

      ctx.db
        .update(articles)
        .set({ status: "pending_assessment", assessmentRetryCount: 0 })
        .where(inArray(articles.id, articleIds))
        .run();

      return {
        assessmentsDeleted: deleted.length,
        articlesReset: articleIds.length,
      };
    }),
});
