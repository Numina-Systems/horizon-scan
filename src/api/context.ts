// pattern: Functional Core
import type { LanguageModel } from "ai";
import type { EmbeddingModel } from "ai";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import type { Logger } from "pino";

/**
 * tRPC context type passed to all procedures.
 * Contains the database instance, application configuration, structured logger,
 * and optional LLM model and embedding model available to query and mutation handlers.
 */
// EmbeddingModel is a union type in ai v4+ (not generic)
export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly model: LanguageModel | null;
  readonly embeddingModel: EmbeddingModel | null;
};
