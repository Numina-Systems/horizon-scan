// pattern: Imperative Shell
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { digests } from "../../db/schema";
import { desc } from "drizzle-orm";

export const digestsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
    )
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(digests)
        .orderBy(desc(digests.sentAt))
        .limit(input.limit)
        .offset(input.offset)
        .all();
    }),
});
