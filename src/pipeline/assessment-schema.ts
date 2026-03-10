import { z } from "zod";

export const assessmentOutputSchema = z
  .object({
    relevant: z.boolean(),
    summary: z.string().default(""),
    tags: z.array(z.string()).default([]),
  })
  .refine(
    (data) => !data.relevant || data.summary.length > 0,
    { message: "Summary is required when article is relevant", path: ["summary"] },
  );

export type AssessmentOutput = Readonly<z.infer<typeof assessmentOutputSchema>>;
