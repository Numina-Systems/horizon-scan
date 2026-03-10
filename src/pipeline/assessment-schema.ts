import { z } from "zod";

export const assessmentOutputSchema = z.object({
  relevant: z.boolean().describe("Whether the article is relevant to the topic"),
  summary: z
    .string()
    .describe(
      "2-3 sentence summary of the article's specific content — facts, announcements, data, or findings. Must not restate the topic description. Empty string if not relevant."
    )
    .default(""),
  tags: z
    .array(z.string())
    .describe(
      "Specific entity names from the article: company names, product names, person names, technology names. Empty array if not relevant."
    )
    .default([]),
});

export type AssessmentOutput = Readonly<z.infer<typeof assessmentOutputSchema>>;
