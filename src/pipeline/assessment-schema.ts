import { z } from "zod";

export const assessmentOutputSchema = z.object({
  relevant: z.boolean().describe("Whether the article is relevant to the topic"),
  summary: z
    .string()
    .describe(
      "2-3 sentence summary of the article's relevance. Empty string if not relevant."
    )
    .default(""),
  tags: z
    .array(z.string())
    .describe(
      "Entity tags extracted from the article (companies, technologies, people). Empty array if not relevant."
    )
    .default([]),
});

export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;
