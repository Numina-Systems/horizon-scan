import { z } from "zod";

const extractorConfigSchema = z.object({
  bodySelector: z.string(),
  jsonLd: z.boolean(),
  metadataSelectors: z.record(z.string(), z.string()).optional(),
});

const feedConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  extractorConfig: extractorConfigSchema,
  pollIntervalMinutes: z.number().int().positive().default(15),
  enabled: z.boolean().default(true),
});

const topicConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  llm: z.object({
    provider: z.enum([
      "anthropic",
      "openai",
      "gemini",
      "ollama",
      "lmstudio",
      "zai",
    ]),
    model: z.string().min(1),
  }),
  feeds: z.array(feedConfigSchema).min(1),
  topics: z.array(topicConfigSchema).min(1),
  schedule: z.object({
    poll: z.string().min(1),
    digest: z.string().min(1),
  }),
  digest: z.object({
    recipient: z.string().email(),
  }),
  extraction: z
    .object({
      maxConcurrency: z.number().int().positive().default(2),
      perDomainDelayMs: z.number().int().nonnegative().default(1000),
    })
    .default({}),
  assessment: z
    .object({
      maxArticleLength: z.number().int().positive().default(4000),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
