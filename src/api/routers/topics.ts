// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { topics } from "../../db/schema";
import { eq } from "drizzle-orm";

export const topicsRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db.select().from(topics).all();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(topics)
        .where(eq(topics.id, input.id))
        .get();
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db
        .insert(topics)
        .values(input)
        .returning()
        .get();
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...updates } = input;
      return ctx.db
        .update(topics)
        .set(updates)
        .where(eq(topics.id, id))
        .returning()
        .get();
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) => {
      ctx.db.delete(topics).where(eq(topics.id, input.id)).run();
      return { success: true };
    }),
});
