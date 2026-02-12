// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { feeds } from "../../db/schema";
import { eq } from "drizzle-orm";

/**
 * tRPC router for managing feeds.
 * Provides queries and mutations for CRUD operations on feeds.
 */
export const feedsRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db.select().from(feeds).all();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(feeds)
        .where(eq(feeds.id, input.id))
        .get();
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
        extractorConfig: z.object({
          bodySelector: z.string(),
          jsonLd: z.boolean(),
          metadataSelectors: z.record(z.string(), z.string()).optional(),
        }),
        pollIntervalMinutes: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db
        .insert(feeds)
        .values(input)
        .returning()
        .get();
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        url: z.string().url().optional(),
        extractorConfig: z
          .object({
            bodySelector: z.string(),
            jsonLd: z.boolean(),
            metadataSelectors: z.record(z.string(), z.string()).optional(),
          })
          .optional(),
        pollIntervalMinutes: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...updates } = input;
      return ctx.db
        .update(feeds)
        .set(updates)
        .where(eq(feeds.id, id))
        .returning()
        .get();
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) => {
      ctx.db.delete(feeds).where(eq(feeds.id, input.id)).run();
      return { success: true };
    }),
});
