// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { assessments } from "../../db/schema";
import { eq, and } from "drizzle-orm";

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
});
